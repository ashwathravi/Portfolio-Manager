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
    currentPrice: 210,
    timeHorizon: '12 months',
    dateCreated: '2026-04-10',
    dateUpdated: '2026-04-17',
    tags: ['services'],
    hypothesis: 'Services will drive margin expansion.',
    bullCase: ['Subscription attach rates rising.'],
    bearCase: ['China volume risk.'],
    catalysts: [{ id: 'c1', title: 'Earnings', date: '2026-05-01', impact: 'high' }],
    linkedEvidence: [{ id: 'e1', title: 'Q2 call', type: 'earnings', date: '2026-04-25' }],
    healthScore: 80,
};

describe('saveThesesToStorage', () => {
    test('writes a versioned envelope', () => {
        const storage = new FakeStorage();
        saveThesesToStorage(storage, [sample]);
        const raw = storage.getItem(THESIS_STORAGE_KEY);
        assert.ok(raw);
        const parsed = JSON.parse(raw!);
        assert.strictEqual(parsed.version, 2);
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
            JSON.stringify({ version: 2, theses: [sample, { broken: true }] }),
        );
        assert.strictEqual(loadThesesFromStorage(storage), null);
    });

    test('migrates v1 envelopes by filling in defaults for the detail fields', () => {
        const v1 = {
            version: 1,
            theses: [
                {
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
                },
            ],
        };
        storage.setItem(THESIS_STORAGE_KEY, JSON.stringify(v1));
        const loaded = loadThesesFromStorage(storage);
        assert.strictEqual(loaded?.length, 1);
        const thesis = loaded![0];
        assert.strictEqual(thesis.hypothesis, '');
        assert.deepStrictEqual(thesis.bullCase, []);
        assert.deepStrictEqual(thesis.bearCase, []);
        assert.deepStrictEqual(thesis.catalysts, []);
        assert.deepStrictEqual(thesis.linkedEvidence, []);
        assert.strictEqual(thesis.healthScore, 50);
        assert.strictEqual(thesis.dateCreated, '2026-04-17');
    });

    test('is a no-op when storage is null (SSR)', () => {
        assert.strictEqual(loadThesesFromStorage(null), null);
    });
});
