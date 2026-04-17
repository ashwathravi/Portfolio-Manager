import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    addCatalyst,
    addEvidence,
    archiveThesis,
    createThesis,
    deleteThesis,
    DEFAULT_THESES,
    findThesisByTicker,
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

    test('defaults status to active and stamps both dateCreated and dateUpdated', () => {
        const t = createThesis(draft, { id: 'x', now: NOW });
        assert.strictEqual(t.status, 'active');
        assert.strictEqual(t.dateCreated, '2026-04-17');
        assert.strictEqual(t.dateUpdated, '2026-04-17');
        assert.deepStrictEqual(t.tags, []);
    });

    test('fills empty defaults for detail fields when draft omits them', () => {
        const t = createThesis(draft, { id: 'x', now: NOW });
        assert.strictEqual(t.hypothesis, '');
        assert.deepStrictEqual(t.bullCase, []);
        assert.deepStrictEqual(t.bearCase, []);
        assert.deepStrictEqual(t.catalysts, []);
        assert.deepStrictEqual(t.linkedEvidence, []);
        assert.strictEqual(t.healthScore, 50);
    });

    test('carries detail fields through when the draft provides them', () => {
        const t = createThesis(
            {
                ...draft,
                hypothesis: 'Margin expansion thesis.',
                bullCase: ['Point A'],
                bearCase: ['Risk X'],
                healthScore: 75,
                currentPrice: 210,
            },
            { id: 'x', now: NOW },
        );
        assert.strictEqual(t.hypothesis, 'Margin expansion thesis.');
        assert.deepStrictEqual(t.bullCase, ['Point A']);
        assert.deepStrictEqual(t.bearCase, ['Risk X']);
        assert.strictEqual(t.healthScore, 75);
        assert.strictEqual(t.currentPrice, 210);
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
        dateCreated: '2024-01-01',
        dateUpdated: '2024-01-01',
        tags: ['services'],
        hypothesis: 'initial hypothesis',
        bullCase: ['a'],
        bearCase: ['b'],
        catalysts: [],
        linkedEvidence: [],
        healthScore: 60,
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

    test('preserves dateCreated when updating', () => {
        const result = updateThesis([original], '1', { title: 'new title' }, { now: NOW });
        assert.strictEqual(result[0].dateCreated, '2024-01-01');
    });

    test('patches detail fields independently', () => {
        const result = updateThesis(
            [original],
            '1',
            { hypothesis: 'updated hypothesis', healthScore: 90 },
            { now: NOW },
        );
        assert.strictEqual(result[0].hypothesis, 'updated hypothesis');
        assert.strictEqual(result[0].healthScore, 90);
        assert.deepStrictEqual(result[0].bullCase, ['a']);
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

describe('findThesisByTicker', () => {
    test('normalizes ticker input and returns the match', () => {
        const hit = findThesisByTicker(DEFAULT_THESES, '  nvda ');
        assert.strictEqual(hit?.id, 'seed-nvda');
    });

    test('returns undefined when not found', () => {
        const miss = findThesisByTicker(DEFAULT_THESES, 'ZZZZ');
        assert.strictEqual(miss, undefined);
    });
});

describe('addCatalyst', () => {
    test('appends a catalyst with a generated id and stamps dateUpdated', () => {
        const result = addCatalyst(
            DEFAULT_THESES,
            'seed-nvda',
            { title: 'New Conference', date: '2026-06-01', impact: 'medium' },
            { id: 'cat-new', now: NOW },
        );
        const nvda = result.find((t) => t.id === 'seed-nvda')!;
        const added = nvda.catalysts.find((c) => c.id === 'cat-new');
        assert.ok(added);
        assert.strictEqual(added?.title, 'New Conference');
        assert.strictEqual(nvda.dateUpdated, '2026-04-17');
    });

    test('no-ops for unknown thesis id', () => {
        const result = addCatalyst(
            DEFAULT_THESES,
            'missing',
            { title: 'x', date: '2026-01-01', impact: 'low' },
            { id: 'cat-x', now: NOW },
        );
        assert.deepStrictEqual(result, DEFAULT_THESES);
    });
});

describe('addEvidence', () => {
    test('prepends evidence so the newest appears first', () => {
        const result = addEvidence(
            DEFAULT_THESES,
            'seed-msft',
            { title: 'New Report', type: 'report', date: '2026-04-10', url: 'https://example.com' },
            { id: 'ev-new', now: NOW },
        );
        const msft = result.find((t) => t.id === 'seed-msft')!;
        assert.strictEqual(msft.linkedEvidence[0].id, 'ev-new');
        assert.strictEqual(msft.linkedEvidence[0].url, 'https://example.com');
        assert.strictEqual(msft.dateUpdated, '2026-04-17');
    });
});
