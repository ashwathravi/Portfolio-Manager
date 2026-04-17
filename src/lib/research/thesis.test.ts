import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    archiveThesis,
    createThesis,
    deleteThesis,
    DEFAULT_THESES,
    partitionTheses,
    restoreThesis,
    updateThesis,
    type Thesis,
    type ThesisDraft,
} from './thesis.ts';

const NOW = () => '2026-04-17';

const draft: ThesisDraft = {
    ticker: 'aapl',
    companyName: '  Apple Inc. ',
    title: '  Services growth ',
    description: 'Strong services revenue acceleration.',
    type: 'bull',
    conviction: 'HIGH',
    targetPrice: 250,
    timeHorizon: '12 months',
};

describe('createThesis', () => {
    test('uppercases the ticker and trims whitespace', () => {
        const t = createThesis(draft, { id: 'x', now: NOW });
        assert.strictEqual(t.ticker, 'AAPL');
        assert.strictEqual(t.companyName, 'Apple Inc.');
        assert.strictEqual(t.title, 'Services growth');
    });

    test('defaults status to active and stamps dateUpdated', () => {
        const t = createThesis(draft, { id: 'x', now: NOW });
        assert.strictEqual(t.status, 'active');
        assert.strictEqual(t.dateUpdated, '2026-04-17');
        assert.deepStrictEqual(t.tags, []);
    });

    test('assigns an id when none is provided', () => {
        const t = createThesis(draft, { now: NOW });
        assert.ok(t.id && t.id.length > 0);
    });
});

describe('updateThesis', () => {
    const original: Thesis = {
        id: '1',
        ticker: 'AAPL',
        companyName: 'Apple Inc.',
        title: 'Services',
        description: 'old',
        type: 'bull',
        status: 'active',
        conviction: 'HIGH',
        targetPrice: 200,
        timeHorizon: '12 months',
        dateUpdated: '2024-01-01',
        tags: ['services'],
    };

    test('patches only the matching id', () => {
        const list = [original, { ...original, id: '2', ticker: 'MSFT' }];
        const result = updateThesis(list, '2', { title: 'Azure' }, { now: NOW });
        assert.strictEqual(result[0].title, 'Services');
        assert.strictEqual(result[1].title, 'Azure');
    });

    test('updates dateUpdated and uppercases ticker when patched', () => {
        const result = updateThesis([original], '1', { ticker: 'aapl', conviction: 'LOW' }, { now: NOW });
        assert.strictEqual(result[0].ticker, 'AAPL');
        assert.strictEqual(result[0].conviction, 'LOW');
        assert.strictEqual(result[0].dateUpdated, '2026-04-17');
    });

    test('returns the list unchanged when id is unknown', () => {
        const result = updateThesis([original], 'missing', { title: 'x' }, { now: NOW });
        assert.deepStrictEqual(result, [original]);
    });
});

describe('archiveThesis / restoreThesis', () => {
    test('archive flips status to archived and stamps dateUpdated', () => {
        const result = archiveThesis(DEFAULT_THESES, 'seed-nvda', { now: NOW });
        const nvda = result.find((t) => t.id === 'seed-nvda');
        assert.strictEqual(nvda?.status, 'archived');
        assert.strictEqual(nvda?.dateUpdated, '2026-04-17');
    });

    test('restore flips status back to active', () => {
        const result = restoreThesis(DEFAULT_THESES, 'seed-meta', { now: NOW });
        const meta = result.find((t) => t.id === 'seed-meta');
        assert.strictEqual(meta?.status, 'active');
    });

    test('does not mutate inputs', () => {
        const snapshot = DEFAULT_THESES.map((t) => ({ ...t }));
        archiveThesis(DEFAULT_THESES, 'seed-nvda', { now: NOW });
        assert.deepStrictEqual(DEFAULT_THESES, snapshot);
    });
});

describe('deleteThesis', () => {
    test('removes the matching id', () => {
        const result = deleteThesis(DEFAULT_THESES, 'seed-nvda');
        assert.strictEqual(result.length, DEFAULT_THESES.length - 1);
        assert.ok(!result.find((t) => t.id === 'seed-nvda'));
    });

    test('is a no-op for unknown id', () => {
        const result = deleteThesis(DEFAULT_THESES, 'missing');
        assert.strictEqual(result.length, DEFAULT_THESES.length);
    });
});

describe('partitionTheses', () => {
    test('splits active and archived correctly', () => {
        const { active, archived } = partitionTheses(DEFAULT_THESES);
        assert.strictEqual(active.length, 3);
        assert.strictEqual(archived.length, 1);
        assert.strictEqual(archived[0].id, 'seed-meta');
    });
});
