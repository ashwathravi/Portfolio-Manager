import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
    JOURNAL_STORAGE_KEY,
    loadJournalFromStorage,
    saveJournalToStorage,
} from './journalStorage.ts';
import { userStorageKey } from '../storage/user-scope.ts';
import type { JournalEntry } from './journal.ts';

const SCOPE = 'user-a';
const KEY = userStorageKey(JOURNAL_STORAGE_KEY, SCOPE);

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
        saveJournalToStorage(storage, [sample], SCOPE);
        const raw = storage.getItem(KEY);
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
        saveJournalToStorage(storage, [sample], SCOPE);
        const loaded = loadJournalFromStorage(storage, SCOPE);
        assert.deepStrictEqual(loaded, [sample]);
    });

    test('returns null when nothing stored', () => {
        assert.strictEqual(loadJournalFromStorage(storage, SCOPE), null);
    });

    test('returns null for unknown version', () => {
        storage.setItem(KEY, JSON.stringify({ version: 999, entries: [sample] }));
        assert.strictEqual(loadJournalFromStorage(storage, SCOPE), null);
    });

    test('returns null when payload is malformed JSON', () => {
        storage.setItem(KEY, '{not json');
        assert.strictEqual(loadJournalFromStorage(storage, SCOPE), null);
    });

    test('returns null when any stored entry fails schema check', () => {
        storage.setItem(
            KEY,
            JSON.stringify({ version: 1, entries: [sample, { broken: true }] }),
        );
        assert.strictEqual(loadJournalFromStorage(storage, SCOPE), null);
    });

    test('is a no-op when storage is null (SSR)', () => {
        assert.strictEqual(loadJournalFromStorage(null), null);
    });
});

describe('journal storage per user', () => {
    test('keeps each user\'s copy apart', () => {
        const storage = new FakeStorage();
        saveJournalToStorage(storage, [sample], 'user-a');

        assert.strictEqual(loadJournalFromStorage(storage, 'user-b'), null);
        assert.strictEqual(loadJournalFromStorage(storage, 'user-a')?.length, 1);
    });

    test('moves a copy saved before keys were per user to the first user who reads it', () => {
        const storage = new FakeStorage();
        saveJournalToStorage(storage, [sample], 'user-a');
        storage.setItem(JOURNAL_STORAGE_KEY, storage.getItem(KEY)!);
        storage.removeItem(KEY);

        assert.strictEqual(loadJournalFromStorage(storage, 'user-a')?.length, 1);
        assert.strictEqual(storage.getItem(JOURNAL_STORAGE_KEY), null);
        assert.strictEqual(loadJournalFromStorage(storage, 'user-b'), null);
    });
});
