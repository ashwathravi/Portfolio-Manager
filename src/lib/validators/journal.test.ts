import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { JOURNAL_ENTRY_PUT_MAX_BYTES, journalEntryPutSchema, journalEntrySchema, journalImportSchema } from './journal';

const ENTRY = {
    id: '3f1c2b9e-8d4a-4f6b-9c1e-2a7d5e8f0b13',
    date: '2026-10-23',
    type: 'entry',
    ticker: 'NVDA',
    decision: 'Opened a position',
    rationale: 'Data-centre demand',
    outcome: 'pending',
    thesisId: null,
    dismissed: false,
};

function message(input: unknown): string | undefined {
    const result = journalEntrySchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
}

describe('journalEntrySchema', () => {
    test('accepts an entry, with or without a thesis', () => {
        assert.equal(journalEntrySchema.safeParse(ENTRY).success, true);
        assert.equal(journalEntrySchema.safeParse({ ...ENTRY, thesisId: 'seed-nvda' }).success, true);
        assert.equal(journalEntrySchema.safeParse({ ...ENTRY, thesisId: 'B2C1A0F4-0D7E-4C55-9E1B-5C2C3E7A8F90' }).success, true);
    });

    test('an entry is live unless it says it was dismissed', () => {
        const live: Partial<typeof ENTRY> = { ...ENTRY };
        delete live.dismissed;
        assert.equal(journalEntrySchema.parse(live).dismissed, false);
        assert.equal(journalEntrySchema.parse({ ...ENTRY, dismissed: true }).dismissed, true);
    });

    test('ids follow the research record rule; example ids included', () => {
        assert.equal(journalEntrySchema.safeParse({ ...ENTRY, id: 'seed-journal-1' }).success, true);
        assert.equal(journalEntrySchema.safeParse({ ...ENTRY, id: 'journal-1761220000000-42' }).success, true);
        assert.equal(message({ ...ENTRY, id: 'Seed Journal' }), 'id must be lowercase letters, digits, dots and hyphens');
    });

    test('type and outcome are one of the journal choices', () => {
        for (const type of ['entry', 'exit', 'hold']) assert.equal(journalEntrySchema.safeParse({ ...ENTRY, type }).success, true);
        for (const outcome of ['win', 'loss', 'pending']) assert.equal(journalEntrySchema.safeParse({ ...ENTRY, outcome }).success, true);
        assert.equal(message({ ...ENTRY, type: 'buy' }), 'type must be entry, exit or hold');
        assert.equal(message({ ...ENTRY, outcome: 'draw' }), 'outcome must be win, loss or pending');
    });

    test('ticker, decision and rationale are required, trimmed and limited', () => {
        assert.equal(message({ ...ENTRY, ticker: '  ' }), 'ticker is required');
        assert.equal(message({ ...ENTRY, decision: '' }), 'decision is required');
        assert.equal(message({ ...ENTRY, rationale: ' ' }), 'rationale is required');
        assert.equal(journalEntrySchema.parse({ ...ENTRY, decision: '  Held  ' }).decision, 'Held');

        assert.equal(journalEntrySchema.safeParse({ ...ENTRY, ticker: 'X'.repeat(20) }).success, true);
        assert.equal(message({ ...ENTRY, ticker: 'X'.repeat(21) }), 'ticker must be at most 20 characters');
        assert.equal(message({ ...ENTRY, ticker: 'NV\u0000DA' }), 'ticker must be printable text');
        assert.equal(journalEntrySchema.safeParse({ ...ENTRY, decision: 'd'.repeat(500) }).success, true);
        assert.equal(message({ ...ENTRY, decision: 'd'.repeat(501) }), 'decision must be at most 500 characters');
        assert.equal(journalEntrySchema.safeParse({ ...ENTRY, rationale: 'r'.repeat(5000) }).success, true);
        assert.equal(message({ ...ENTRY, rationale: 'r'.repeat(5001) }), 'rationale must be at most 5000 characters');
    });

    test('free text may contain angle brackets and line breaks', () => {
        const parsed = journalEntrySchema.parse({ ...ENTRY, rationale: 'P/E <30\nand rising' });
        assert.equal(parsed.rationale, 'P/E <30\nand rising');
    });

    test('date is a calendar date', () => {
        assert.equal(message({ ...ENTRY, date: '' }), 'date must be a date (YYYY-MM-DD)');
        assert.equal(message({ ...ENTRY, date: '2026-02-30' }), 'date must be a date (YYYY-MM-DD)');
    });

    test('thesisId is a thesis ID or null, never missing', () => {
        assert.equal(message({ ...ENTRY, thesisId: '../x' }), 'thesisId must be a thesis ID');
        assert.equal(message({ ...ENTRY, thesisId: '' }), 'thesisId must be a thesis ID');
        const missing: Partial<typeof ENTRY> = { ...ENTRY };
        delete missing.thesisId;
        assert.equal(journalEntrySchema.safeParse(missing).success, false);
    });

    test('refuses fields it does not store', () => {
        assert.equal(journalEntrySchema.safeParse({ ...ENTRY, userId: 'someone-else' }).success, false);
    });
});

describe('journalImportSchema', () => {
    test('accepts an empty list and up to 500 entries', () => {
        assert.equal(journalImportSchema.safeParse({ items: [] }).success, true);
        const items = Array.from({ length: 500 }, (_, i) => ({ ...ENTRY, id: `e-${i}` }));
        assert.equal(journalImportSchema.safeParse({ items }).success, true);
    });

    test('a batch says where it starts in the journal and when the move began', () => {
        assert.equal(journalImportSchema.parse({ items: [] }).first, 0);
        assert.deepEqual(journalImportSchema.parse({ items: [], first: 100, startedAt: 1_761_220_000_000 }), { items: [], first: 100, startedAt: 1_761_220_000_000 });
        assert.equal(journalImportSchema.safeParse({ items: [], first: -1 }).error?.issues[0]?.message, 'first must be 0 or more');
    });

    test('refuses more than 500 entries, a bad entry, or extra fields', () => {
        const items = Array.from({ length: 501 }, (_, i) => ({ ...ENTRY, id: `e-${i}` }));
        const tooMany = journalImportSchema.safeParse({ items });
        assert.equal(tooMany.error?.issues[0]?.message, 'at most 500 entries');
        assert.equal(journalImportSchema.safeParse({ items: [{ ...ENTRY, ticker: '' }] }).success, false);
        assert.equal(journalImportSchema.safeParse({ items: [], replace: true }).success, false);
    });
});

describe('journal writes', () => {
    const order = { session: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', seq: 1 };

    test('a PUT carries the entry and the order', () => {
        assert.equal(journalEntryPutSchema.safeParse({ entry: ENTRY, order }).success, true);
        assert.equal(journalEntryPutSchema.safeParse({ entry: { ...ENTRY, dismissed: true }, order }).success, true);
        assert.equal(journalEntryPutSchema.safeParse({ entry: ENTRY }).success, false);
        assert.equal(journalEntryPutSchema.safeParse(ENTRY).success, false);
        assert.equal(journalEntryPutSchema.safeParse({ entry: ENTRY, order: { ...order, seq: 0 } }).error?.issues[0]?.message, 'seq must be at least 1');
    });

    test('the largest entry the schema allows fits the PUT body limit', () => {
        const escaped = (n: number) => '\u0001'.repeat(n); // 6 bytes each once escaped
        const entry = {
            ...ENTRY,
            id: 'a'.repeat(64),
            ticker: 'T'.repeat(20),
            decision: escaped(500),
            rationale: escaped(5000),
            thesisId: 'A'.repeat(64),
        };
        // The schema trims: give each field a printable first character.
        entry.decision = `d${entry.decision.slice(1)}`;
        entry.rationale = `r${entry.rationale.slice(1)}`;
        const body = { entry, order: { session: 'a'.repeat(64), seq: Number.MAX_SAFE_INTEGER } };
        assert.equal(journalEntryPutSchema.safeParse(body).success, true);
        const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
        assert.ok(bytes <= JOURNAL_ENTRY_PUT_MAX_BYTES, `${bytes} bytes`);
        assert.ok(JOURNAL_ENTRY_PUT_MAX_BYTES < 64 * 1024);
    });
});
