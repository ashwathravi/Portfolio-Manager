import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
    JOURNAL_STORAGE_KEY,
    loadJournalFromStorage,
    saveJournalToStorage,
} from './journalStorage.ts';
import type { JournalEntry } from './journal.ts';

class FakeStorage {
    private store = new Map<string, string>();
    getItem(key: string) { return this.store.get(key) ?? null; }
    setItem(key: string, value: string) { this.store.set(key, value); }
    removeItem(key: string) { this.store.delete(key); }
    clear() { this.store.clear(); }
}

const sample: JournalEntry = {
    id: '1',
    date: '2026-04-01',
    type: 'entry',
    ticker: 'AAPL',
    decision: 'Bought 10 shares',
    rationale: 'Services growth catalyst.',
    outcome: 'pending',
    thesisId: 'seed-aapl',
};

describe('saveJournalToStorage', () => {
    test('writes a versioned envelope', () => {
        const storage = new FakeStorage();
        saveJournalToStorage(storage, [sample]);
        const raw = storage.getItem(JOURNAL_STORAGE_KEY);
        assert.ok(raw);
        const parsed = JSON.parse(raw!);
        assert.strictEqual(parsed.version, 1);
        assert.strictEqual(parsed.entries.length, 1);
    });

    test('is a no-op when storage is null (SSR)', () => {
        assert.doesNotThrow(() => saveJournalToStorage(null, [sample]));
    });
});

describe('loadJournalFromStorage', () => {
    let storage: FakeStorage;
    beforeEach(() => { storage = new FakeStorage(); });

    test('round-trips what was saved', () => {
        saveJournalToStorage(storage, [sample]);
        const loaded = loadJournalFromStorage(storage);
        assert.deepStrictEqual(loaded, [sample]);
    });

    test('returns null when nothing stored', () => {
        assert.strictEqual(loadJournalFromStorage(storage), null);
    });

    test('returns null for unknown version', () => {
        storage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify({ version: 999, entries: [sample] }));
        assert.strictEqual(loadJournalFromStorage(storage), null);
    });

    test('returns null when payload is malformed JSON', () => {
        storage.setItem(JOURNAL_STORAGE_KEY, '{not json');
        assert.strictEqual(loadJournalFromStorage(storage), null);
    });

    test('returns null when any stored entry fails schema check', () => {
        storage.setItem(
            JOURNAL_STORAGE_KEY,
            JSON.stringify({ version: 1, entries: [sample, { broken: true }] }),
        );
        assert.strictEqual(loadJournalFromStorage(storage), null);
    });

    test('is a no-op when storage is null (SSR)', () => {
        assert.strictEqual(loadJournalFromStorage(null), null);
    });
});
