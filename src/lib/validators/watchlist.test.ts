import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { watchItemDeleteSchema, watchItemPutSchema, watchItemSchema, watchlistImportSchema } from './watchlist';

const ITEM = {
    id: 'w-nvda-mgx2k1',
    ticker: 'NVDA',
    companyName: 'NVIDIA Corporation',
    reason: 'Data-centre demand',
    notes: '',
    targetEntry: 120.5,
    addedAt: '2026-10-23',
    dismissed: false,
};

function message(input: unknown): string | undefined {
    const result = watchItemSchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
}

describe('watchItemSchema', () => {
    test('accepts an item, with or without a target entry', () => {
        assert.equal(watchItemSchema.safeParse(ITEM).success, true);
        assert.equal(watchItemSchema.safeParse({ ...ITEM, targetEntry: null }).success, true);
    });

    test('an item is live unless it says it was dismissed', () => {
        const live: Partial<typeof ITEM> = { ...ITEM };
        delete live.dismissed;
        const parsed = watchItemSchema.parse(live);
        assert.equal(parsed.dismissed, false);
        assert.equal(watchItemSchema.parse({ ...ITEM, dismissed: true }).dismissed, true);
    });

    test('free text may contain angle brackets, and the short fields are trimmed', () => {
        const parsed = watchItemSchema.parse({ ...ITEM, companyName: '  NVIDIA  ', reason: ' P/E <30 ', notes: 'buy <$100 ' });
        assert.equal(parsed.companyName, 'NVIDIA');
        assert.equal(parsed.reason, 'P/E <30');
        assert.equal(parsed.notes, 'buy <$100 ');
    });

    test('ids are lowercase letters, digits, dots and hyphens, up to 64 characters', () => {
        assert.equal(watchItemSchema.safeParse({ ...ITEM, id: 'w-brk.b-1' }).success, true);
        assert.equal(watchItemSchema.safeParse({ ...ITEM, id: 'a'.repeat(64) }).success, true);
        assert.equal(message({ ...ITEM, id: 'a'.repeat(65) }), 'id must be lowercase letters, digits, dots and hyphens');
        assert.equal(message({ ...ITEM, id: 'W-NVDA' }), 'id must be lowercase letters, digits, dots and hyphens');
        assert.equal(message({ ...ITEM, id: '-nvda' }), 'id must be lowercase letters, digits, dots and hyphens');
        assert.equal(message({ ...ITEM, id: 'w/nvda' }), 'id must be lowercase letters, digits, dots and hyphens');
        assert.equal(message({ ...ITEM, id: '' }), 'id must be lowercase letters, digits, dots and hyphens');
    });

    test('the ticker follows the quote API rules', () => {
        assert.equal(watchItemSchema.safeParse({ ...ITEM, ticker: 'BTC-USD' }).success, true);
        assert.match(message({ ...ITEM, ticker: 'nvda' }) ?? '', /uppercase/);
        assert.equal(message({ ...ITEM, ticker: 'ABCDEFGHIJK' }), 'Ticker symbol too long');
    });

    test('text fields have limits, measured after trimming', () => {
        assert.equal(watchItemSchema.safeParse({ ...ITEM, companyName: 'x'.repeat(200) }).success, true);
        assert.equal(watchItemSchema.safeParse({ ...ITEM, companyName: ` ${'x'.repeat(200)} ` }).success, true);
        assert.equal(message({ ...ITEM, companyName: 'x'.repeat(201) }), 'companyName must be at most 200 characters');
        assert.equal(watchItemSchema.safeParse({ ...ITEM, reason: 'x'.repeat(500) }).success, true);
        assert.equal(message({ ...ITEM, reason: 'x'.repeat(501) }), 'reason must be at most 500 characters');
        assert.equal(watchItemSchema.safeParse({ ...ITEM, notes: 'x'.repeat(5000) }).success, true);
        assert.equal(message({ ...ITEM, notes: 'x'.repeat(5001) }), 'notes must be at most 5000 characters');
    });

    test('the target entry is a positive, finite price or null', () => {
        assert.equal(watchItemSchema.safeParse({ ...ITEM, targetEntry: 0.01 }).success, true);
        assert.equal(message({ ...ITEM, targetEntry: 0 }), 'targetEntry must be a positive price');
        assert.equal(message({ ...ITEM, targetEntry: -5 }), 'targetEntry must be a positive price');
        assert.equal(watchItemSchema.safeParse({ ...ITEM, targetEntry: Number.POSITIVE_INFINITY }).success, false);
        assert.equal(watchItemSchema.safeParse({ ...ITEM, targetEntry: '120' }).success, false);
        assert.equal(watchItemSchema.safeParse({ ...ITEM, targetEntry: undefined }).success, false);
    });

    test('addedAt is a calendar date', () => {
        assert.equal(message({ ...ITEM, addedAt: '' }), 'addedAt must be a date (YYYY-MM-DD)');
        assert.equal(message({ ...ITEM, addedAt: '2026-13-01' }), 'addedAt must be a date (YYYY-MM-DD)');
        assert.equal(message({ ...ITEM, addedAt: '2026-10-23T00:00:00Z' }), 'addedAt must be a date (YYYY-MM-DD)');
    });

    test('refuses fields it does not store, the example flag included', () => {
        assert.equal(watchItemSchema.safeParse({ ...ITEM, sample: true }).success, false);
        assert.equal(watchItemSchema.safeParse({ ...ITEM, userId: 'someone-else' }).success, false);
    });
});

describe('watchlistImportSchema', () => {
    test('accepts an empty list and up to 500 items', () => {
        assert.equal(watchlistImportSchema.safeParse({ items: [] }).success, true);
        const items = Array.from({ length: 500 }, (_, i) => ({ ...ITEM, id: `w-${i}` }));
        assert.equal(watchlistImportSchema.safeParse({ items }).success, true);
    });

    test('refuses more than 500 items, a bad item, or extra fields', () => {
        const items = Array.from({ length: 501 }, (_, i) => ({ ...ITEM, id: `w-${i}` }));
        const tooMany = watchlistImportSchema.safeParse({ items });
        assert.equal(tooMany.success, false);
        assert.equal(tooMany.error?.issues[0]?.message, 'at most 500 items');
        assert.equal(watchlistImportSchema.safeParse({ items: [{ ...ITEM, ticker: '' }] }).success, false);
        assert.equal(watchlistImportSchema.safeParse({ items: [], replace: true }).success, false);
        assert.equal(watchlistImportSchema.safeParse({}).success, false);
    });
});

describe('write order', () => {
    const order = { session: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', seq: 1 };

    test('a PUT carries the item and the order; a DELETE only the order', () => {
        assert.equal(watchItemPutSchema.safeParse({ item: ITEM, order }).success, true);
        assert.equal(watchItemDeleteSchema.safeParse({ order }).success, true);
        assert.equal(watchItemPutSchema.safeParse({ item: ITEM }).success, false);
        assert.equal(watchItemPutSchema.safeParse(ITEM).success, false);
        assert.equal(watchItemDeleteSchema.safeParse({}).success, false);
        assert.equal(watchItemDeleteSchema.safeParse({ order, item: ITEM }).success, false);
    });

    test('the session is a page ID and seq a whole number from 1', () => {
        const put = (o: unknown) => watchItemPutSchema.safeParse({ item: ITEM, order: o });
        assert.equal(put({ ...order, session: 'abcd1234' }).success, true);
        assert.equal(put({ ...order, session: 'short' }).error?.issues[0]?.message, 'session must be a page ID');
        assert.equal(put({ ...order, session: 'NOT-LOWER-CASE' }).error?.issues[0]?.message, 'session must be a page ID');
        assert.equal(put({ ...order, session: 'a'.repeat(65) }).success, false);
        assert.equal(put({ ...order, seq: Number.MAX_SAFE_INTEGER }).success, true);
        assert.equal(put({ ...order, seq: 0 }).error?.issues[0]?.message, 'seq must be at least 1');
        assert.equal(put({ ...order, seq: 1.5 }).error?.issues[0]?.message, 'seq must be a whole number');
        assert.equal(put({ ...order, seq: Number.MAX_SAFE_INTEGER + 2 }).success, false);
        assert.equal(put({ ...order, extra: 1 }).success, false);
    });
});
