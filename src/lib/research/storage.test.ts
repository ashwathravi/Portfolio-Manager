import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
    loadThesesFromStorage,
    saveThesesToStorage,
    THESIS_STORAGE_KEY,
} from './storage.ts';
import type { Thesis } from './thesis.ts';

class FakeStorage {
    private store = new Map<string, string>();
    getItem(key: string) { return this.store.get(key) ?? null; }
    setItem(key: string, value: string) { this.store.set(key, value); }
    removeItem(key: string) { this.store.delete(key); }
    clear() { this.store.clear(); }
}

const sample: Thesis = {
    id: '1',
    ticker: 'AAPL',
    companyName: 'Apple Inc.',
    title: 'Services',
    description: 'x',
    type: 'bull',
    status: 'active',
    conviction: 'HIGH',
    targetPrice: 250,
    timeHorizon: '12 months',
    dateUpdated: '2026-04-17',
    tags: [],
};

describe('saveThesesToStorage', () => {
    test('writes a versioned envelope', () => {
        const storage = new FakeStorage();
        saveThesesToStorage(storage, [sample]);
        const raw = storage.getItem(THESIS_STORAGE_KEY);
        assert.ok(raw);
        const parsed = JSON.parse(raw!);
        assert.strictEqual(parsed.version, 1);
        assert.strictEqual(parsed.theses.length, 1);
    });

    test('is a no-op when storage is null (SSR)', () => {
        assert.doesNotThrow(() => saveThesesToStorage(null, [sample]));
    });
});

describe('loadThesesFromStorage', () => {
    let storage: FakeStorage;
    beforeEach(() => { storage = new FakeStorage(); });

    test('round-trips what was saved', () => {
        saveThesesToStorage(storage, [sample]);
        const loaded = loadThesesFromStorage(storage);
        assert.deepStrictEqual(loaded, [sample]);
    });

    test('returns null when nothing stored', () => {
        assert.strictEqual(loadThesesFromStorage(storage), null);
    });

    test('returns null for unknown version (migration trigger)', () => {
        storage.setItem(THESIS_STORAGE_KEY, JSON.stringify({ version: 999, theses: [sample] }));
        assert.strictEqual(loadThesesFromStorage(storage), null);
    });

    test('returns null when payload is malformed JSON', () => {
        storage.setItem(THESIS_STORAGE_KEY, '{not json');
        assert.strictEqual(loadThesesFromStorage(storage), null);
    });

    test('returns null when any stored thesis fails schema check', () => {
        storage.setItem(
            THESIS_STORAGE_KEY,
            JSON.stringify({ version: 1, theses: [sample, { broken: true }] }),
        );
        assert.strictEqual(loadThesesFromStorage(storage), null);
    });

    test('is a no-op when storage is null (SSR)', () => {
        assert.strictEqual(loadThesesFromStorage(null), null);
    });
});
