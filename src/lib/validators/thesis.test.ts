import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { THESIS_PUT_MAX_BYTES, THESIS_LIMITS, thesisImportSchema, thesisPutSchema, thesisSchema } from './thesis';

const THESIS = {
    id: 'b2c1a0f4-0d7e-4c55-9e1b-5c2c3e7a8f90',
    ticker: 'NVDA',
    companyName: 'NVIDIA Corporation',
    title: 'AI infrastructure',
    description: 'Data-centre demand',
    type: 'bull',
    status: 'active',
    conviction: 'HIGH',
    targetPrice: 950,
    currentPrice: null,
    timeHorizon: '18 months',
    dateCreated: '2026-10-01',
    dateUpdated: '2026-10-23',
    tags: ['AI'],
    hypothesis: '',
    bullCase: ['CUDA moat'],
    bearCase: [],
    catalysts: [{ id: 'cat-1', title: 'Earnings', date: 'Q2 2026', impact: 'high' }],
    linkedEvidence: [{ id: 'ev-1', title: 'Transcript', type: 'earnings', date: '2026-10-20', url: 'https://example.com/t' }],
    healthScore: 70,
    dismissed: false,
};

function message(input: unknown): string | undefined {
    const result = thesisSchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
}

describe('thesisSchema', () => {
    test('accepts a thesis with its catalysts and evidence', () => {
        assert.equal(thesisSchema.safeParse(THESIS).success, true);
        assert.equal(thesisSchema.safeParse({ ...THESIS, currentPrice: 875.28, linkedEvidence: [{ ...THESIS.linkedEvidence[0], url: null }] }).success, true);
        assert.equal(thesisSchema.safeParse({ ...THESIS, id: 'seed-nvda' }).success, true);
    });

    test('a thesis is live unless it says it was deleted', () => {
        const live: Partial<typeof THESIS> = { ...THESIS };
        delete live.dismissed;
        assert.equal(thesisSchema.parse(live).dismissed, false);
    });

    test('the choices are the app\'s', () => {
        assert.equal(message({ ...THESIS, type: 'long' }), 'type must be bull or bear');
        assert.equal(message({ ...THESIS, status: 'closed' }), 'status must be active, monitoring or archived');
        assert.equal(message({ ...THESIS, conviction: 'high' }), 'conviction must be HIGH, MEDIUM or LOW');
        assert.equal(message({ ...THESIS, catalysts: [{ ...THESIS.catalysts[0], impact: 'huge' }] }), 'impact must be high, medium or low');
        assert.equal(message({ ...THESIS, linkedEvidence: [{ ...THESIS.linkedEvidence[0], type: 'tweet' }] }), 'evidence type must be article, report, earnings or note');
    });

    test('ticker and title are required; text has limits', () => {
        assert.equal(message({ ...THESIS, ticker: ' ' }), 'ticker is required');
        assert.equal(message({ ...THESIS, title: '' }), 'title is required');
        assert.equal(thesisSchema.safeParse({ ...THESIS, title: 't'.repeat(THESIS_LIMITS.title) }).success, true);
        assert.equal(message({ ...THESIS, title: 't'.repeat(201) }), 'title must be at most 200 characters');
        assert.equal(message({ ...THESIS, description: 'd'.repeat(5001) }), 'description must be at most 5000 characters');
        assert.equal(message({ ...THESIS, hypothesis: 'h'.repeat(5001) }), 'hypothesis must be at most 5000 characters');
        assert.equal(message({ ...THESIS, timeHorizon: 'h'.repeat(51) }), 'timeHorizon must be at most 50 characters');
        assert.equal(message({ ...THESIS, ticker: 'NV\u0000DA' }), 'ticker must be printable text');
    });

    test('lists have limits, and their items can\'t be empty', () => {
        assert.equal(message({ ...THESIS, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }), 'at most 20 tags');
        assert.equal(message({ ...THESIS, tags: [''] }), "tags can't be empty");
        assert.equal(message({ ...THESIS, bullCase: [' '] }), "bull case items can't be empty");
        assert.equal(message({ ...THESIS, bearCase: ['b'.repeat(1001)] }), 'bear case items must be at most 1000 characters');
        const many = (n: number, make: (i: number) => object) => Array.from({ length: n }, (_, i) => make(i));
        assert.equal(message({ ...THESIS, catalysts: many(51, (i) => ({ ...THESIS.catalysts[0], id: `c-${i}` })) }), 'at most 50 catalysts');
        assert.equal(message({ ...THESIS, linkedEvidence: many(51, (i) => ({ ...THESIS.linkedEvidence[0], id: `e-${i}` })) }), 'at most 50 pieces of evidence');
        assert.equal(message({ ...THESIS, catalysts: [{ ...THESIS.catalysts[0], title: '' }] }), 'catalyst title is required');
        assert.equal(message({ ...THESIS, catalysts: [{ ...THESIS.catalysts[0], date: 'd'.repeat(41) }] }), 'catalyst date must be at most 40 characters');
    });

    test('catalyst and evidence ids are unique within a thesis', () => {
        assert.equal(message({ ...THESIS, catalysts: [THESIS.catalysts[0], THESIS.catalysts[0]] }), 'catalyst ids must be unique');
        assert.equal(message({ ...THESIS, linkedEvidence: [THESIS.linkedEvidence[0], THESIS.linkedEvidence[0]] }), 'evidence ids must be unique');
    });

    test('evidence links are http or https only', () => {
        const withUrl = (url: string) => ({ ...THESIS, linkedEvidence: [{ ...THESIS.linkedEvidence[0], url }] });
        assert.equal(thesisSchema.safeParse(withUrl('http://example.com')).success, true);
        for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'not a url', '']) {
            assert.equal(message(withUrl(url)), 'url must be an http or https link', url);
        }
        assert.equal(message(withUrl(`https://example.com/${'a'.repeat(2000)}`)), 'url must be at most 2000 characters');
    });

    test('prices, dates and the health score', () => {
        assert.equal(thesisSchema.safeParse({ ...THESIS, targetPrice: 0 }).success, true);
        assert.equal(message({ ...THESIS, targetPrice: -1 }), 'targetPrice must be 0 or more');
        assert.equal(message({ ...THESIS, currentPrice: -1 }), 'currentPrice must be 0 or more');
        assert.equal(message({ ...THESIS, dateCreated: '' }), 'dateCreated must be a date (YYYY-MM-DD)');
        assert.equal(message({ ...THESIS, dateUpdated: '2026-13-01' }), 'dateUpdated must be a date (YYYY-MM-DD)');
        assert.equal(message({ ...THESIS, healthScore: 101 }), 'healthScore must be 0 to 100');
        assert.equal(message({ ...THESIS, healthScore: 50.5 }), 'healthScore must be a whole number');
    });

    test('refuses fields it does not store', () => {
        assert.equal(thesisSchema.safeParse({ ...THESIS, userId: 'someone-else' }).success, false);
        assert.equal(thesisSchema.safeParse({ ...THESIS, catalysts: [{ ...THESIS.catalysts[0], extra: 1 }] }).success, false);
    });
});

describe('thesis writes and imports', () => {
    const order = { session: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', seq: 1 };

    test('a PUT carries the thesis and the order', () => {
        assert.equal(thesisPutSchema.safeParse({ thesis: THESIS, order }).success, true);
        assert.equal(thesisPutSchema.safeParse({ thesis: THESIS }).success, false);
        assert.equal(thesisPutSchema.safeParse(THESIS).success, false);
    });

    test('the largest thesis the schema allows fits the PUT body limit', () => {
        // Free text at its widest once JSON-escaped (6 bytes a character);
        // short fields take printable text only, at most 3 bytes a character.
        const escaped = (n: number) => `x${'\u0001'.repeat(n - 1)}`;
        const wide = (n: number) => '株'.repeat(n);
        const thesis = {
            ...THESIS,
            id: 'a'.repeat(64),
            ticker: wide(20),
            companyName: wide(200),
            title: wide(200),
            description: escaped(5000),
            timeHorizon: wide(50),
            tags: Array.from({ length: 20 }, () => wide(40)),
            hypothesis: escaped(5000),
            bullCase: Array.from({ length: 20 }, () => escaped(1000)),
            bearCase: Array.from({ length: 20 }, () => escaped(1000)),
            catalysts: Array.from({ length: 50 }, (_, i) => ({ id: `c-${i}`, title: wide(200), date: wide(40), impact: 'high' })),
            linkedEvidence: Array.from({ length: 50 }, (_, i) => ({
                id: `e-${i}`, title: wide(200), type: 'note', date: wide(40), url: `https://example.com/${'a'.repeat(1970)}`,
            })),
        };
        const body = { thesis, order: { session: 'a'.repeat(64), seq: Number.MAX_SAFE_INTEGER } };
        assert.equal(thesisPutSchema.safeParse(body).success, true);
        const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
        assert.ok(bytes <= THESIS_PUT_MAX_BYTES, `${bytes} bytes`);
        // Under Vercel's 4.5 MB request limit.
        assert.ok(THESIS_PUT_MAX_BYTES < 4.5 * 1000 * 1000);
    });

    test('an import batch carries up to 200 theses and its place in the list', () => {
        assert.deepEqual(thesisImportSchema.parse({ items: [] }), { items: [], first: 0 });
        assert.equal(thesisImportSchema.safeParse({ items: [THESIS], first: 3, startedAt: 1_761_220_000_000 }).success, true);
        const items = Array.from({ length: 201 }, (_, i) => ({ ...THESIS, id: `t-${i}` }));
        assert.equal(thesisImportSchema.safeParse({ items }).error?.issues[0]?.message, 'at most 200 theses');
        assert.equal(thesisImportSchema.safeParse({ items: [], replace: true }).success, false);
    });
});
