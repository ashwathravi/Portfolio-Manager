import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    createJournalEntry,
    DEFAULT_JOURNAL_ENTRIES,
    deleteJournalEntry,
    filterJournalByThesis,
    sortJournalEntries,
    updateJournalEntry,
    type JournalDraft,
    type JournalEntry,
} from './journal.ts';

const NOW = () => '2026-04-17';

const draft: JournalDraft = {
    type: 'entry',
    ticker: 'aapl',
    decision: '  Opened position  ',
    rationale: '  Conviction on services growth.  ',
};

describe('createJournalEntry', () => {
    test('uppercases ticker, trims whitespace, defaults date + outcome', () => {
        const entry = createJournalEntry(draft, { id: 'x', now: NOW });
        assert.strictEqual(entry.ticker, 'AAPL');
        assert.strictEqual(entry.decision, 'Opened position');
        assert.strictEqual(entry.rationale, 'Conviction on services growth.');
        assert.strictEqual(entry.date, '2026-04-17');
        assert.strictEqual(entry.outcome, 'pending');
    });

    test('preserves explicit date and outcome from the draft', () => {
        const entry = createJournalEntry(
            { ...draft, date: '2026-01-01', outcome: 'win', thesisId: 'seed-nvda' },
            { id: 'x', now: NOW },
        );
        assert.strictEqual(entry.date, '2026-01-01');
        assert.strictEqual(entry.outcome, 'win');
        assert.strictEqual(entry.thesisId, 'seed-nvda');
    });

    test('assigns an id when none is provided', () => {
        const entry = createJournalEntry(draft, { now: NOW });
        assert.ok(entry.id && entry.id.length > 0);
    });
});

describe('updateJournalEntry', () => {
    const original: JournalEntry = {
        id: '1',
        date: '2026-03-01',
        type: 'entry',
        ticker: 'AAPL',
        decision: 'old decision',
        rationale: 'old rationale',
        outcome: 'pending',
    };

    test('patches only the matching id and trims string fields', () => {
        const list = [original, { ...original, id: '2', ticker: 'MSFT' }];
        const result = updateJournalEntry(list, '2', { decision: '  Closed  ', outcome: 'win' });
        assert.strictEqual(result[0].decision, 'old decision');
        assert.strictEqual(result[1].decision, 'Closed');
        assert.strictEqual(result[1].outcome, 'win');
    });

    test('uppercases ticker when patched', () => {
        const result = updateJournalEntry([original], '1', { ticker: 'msft' });
        assert.strictEqual(result[0].ticker, 'MSFT');
    });

    test('preserves date when patch.date is blank', () => {
        const result = updateJournalEntry([original], '1', { date: '   ' });
        assert.strictEqual(result[0].date, '2026-03-01');
    });

    test('links and unlinks a thesis by patching thesisId', () => {
        const linked = updateJournalEntry([original], '1', { thesisId: 'seed-nvda' });
        assert.strictEqual(linked[0].thesisId, 'seed-nvda');
        const unlinked = updateJournalEntry(linked, '1', { thesisId: undefined });
        assert.strictEqual(unlinked[0].thesisId, undefined);
    });

    test('returns the list unchanged when id is unknown', () => {
        const result = updateJournalEntry([original], 'missing', { decision: 'x' });
        assert.deepStrictEqual(result, [original]);
    });
});

describe('deleteJournalEntry', () => {
    test('removes the matching id', () => {
        const result = deleteJournalEntry(DEFAULT_JOURNAL_ENTRIES, 'seed-journal-1');
        assert.strictEqual(result.length, DEFAULT_JOURNAL_ENTRIES.length - 1);
        assert.ok(!result.find((e) => e.id === 'seed-journal-1'));
    });

    test('is a no-op for unknown id', () => {
        const result = deleteJournalEntry(DEFAULT_JOURNAL_ENTRIES, 'missing');
        assert.strictEqual(result.length, DEFAULT_JOURNAL_ENTRIES.length);
    });
});

describe('sortJournalEntries', () => {
    test('returns entries sorted by date descending without mutating the input', () => {
        const sorted = sortJournalEntries(DEFAULT_JOURNAL_ENTRIES);
        assert.strictEqual(sorted[0].id, 'seed-journal-1');
        assert.strictEqual(sorted[sorted.length - 1].id, 'seed-journal-4');
        assert.strictEqual(DEFAULT_JOURNAL_ENTRIES[0].id, 'seed-journal-1');
    });
});

describe('filterJournalByThesis', () => {
    test('returns only entries linked to the given thesis id', () => {
        const nvda = filterJournalByThesis(DEFAULT_JOURNAL_ENTRIES, 'seed-nvda');
        assert.strictEqual(nvda.length, 1);
        assert.strictEqual(nvda[0].ticker, 'NVDA');
    });

    test('returns empty array when nothing is linked', () => {
        const result = filterJournalByThesis(DEFAULT_JOURNAL_ENTRIES, 'missing-thesis');
        assert.deepStrictEqual(result, []);
    });
});
