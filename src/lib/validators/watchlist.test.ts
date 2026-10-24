import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { WATCH_ITEM_PUT_MAX_BYTES, watchItemPutSchema, watchItemSchema, watchlistImportSchema } from './watchlist';

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

    test('a batch says where it starts in the list and when the move began', () => {
        assert.equal(watchlistImportSchema.parse({ items: [] }).first, 0);
        assert.deepEqual(watchlistImportSchema.parse({ items: [], first: 500, startedAt: 1_761_220_000_000 }), { items: [], first: 500, startedAt: 1_761_220_000_000 });
        const message = (input: unknown) => watchlistImportSchema.safeParse(input).error?.issues[0]?.message;
        assert.equal(message({ items: [], first: -1 }), 'first must be 0 or more');
        assert.equal(message({ items: [], first: 1.5 }), 'first must be a whole number');
        assert.equal(message({ items: [], first: 1_000_001 }), 'first is too large');
        assert.equal(message({ items: [], startedAt: 0 }), 'startedAt must be a time in milliseconds');
        assert.equal(message({ items: [], startedAt: '2026-10-23' }) !== undefined, true);
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

    test('a PUT carries the item and the order', () => {
        assert.equal(watchItemPutSchema.safeParse({ item: ITEM, order }).success, true);
        assert.equal(watchItemPutSchema.safeParse({ item: { ...ITEM, dismissed: true }, order }).success, true);
        assert.equal(watchItemPutSchema.safeParse({ item: ITEM }).success, false);
        assert.equal(watchItemPutSchema.safeParse(ITEM).success, false);
        assert.equal(watchItemPutSchema.safeParse({ item: ITEM, order, extra: 1 }).success, false);
    });

    test('regression: the largest item the schema allows fits the PUT body limit', () => {
        // The Codex finding on PR #147: long non-ASCII text passed the
        // schema but not the old 16 KiB limit, so saving it failed.
        const escaped = (n: number) => '\u0001'.repeat(n); // 6 bytes each once escaped
        const item = {
            ...ITEM,
            id: 'a'.repeat(64),
            ticker: 'ABCDEFGHIJ',
            companyName: escaped(200),
            reason: escaped(500),
            notes: escaped(5000),
            targetEntry: Number.MAX_VALUE,
        };
        const body = { item, order: { session: 'a'.repeat(64), seq: Number.MAX_SAFE_INTEGER } };
        assert.equal(watchItemPutSchema.safeParse(body).success, true);
        const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
        assert.ok(bytes <= WATCH_ITEM_PUT_MAX_BYTES, `${bytes} bytes`);
        assert.ok(WATCH_ITEM_PUT_MAX_BYTES < 64 * 1024);
        // And unescaped text at UTF-8's widest per counted character.
        const wide = { ...body, item: { ...item, companyName: '株'.repeat(200), reason: '株'.repeat(500), notes: '😀'.repeat(2500) } };
        assert.equal(watchItemPutSchema.safeParse(wide).success, true);
        assert.ok(new TextEncoder().encode(JSON.stringify(wide)).length <= WATCH_ITEM_PUT_MAX_BYTES);
    });
});
