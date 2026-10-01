import { test, describe } from 'node:test';
import assert from 'node:assert';
import type { Thesis } from './thesis';
import { checkThesis } from './thesisCheck';

const NOW = Date.parse('2026-09-30T12:00:00Z');

const thesis = (patch: Partial<Thesis> = {}): Thesis => ({
    id: 't1',
    ticker: 'NVDA',
    companyName: 'NVIDIA',
    title: 'AI',
    description: '',
    type: 'bull',
    status: 'active',
    conviction: 'HIGH',
    targetPrice: 1,
    timeHorizon: '12 months',
    dateCreated: '2026-01-01',
    dateUpdated: '2026-09-20',
    tags: [],
    hypothesis: '',
    bullCase: ['a'],
    bearCase: ['b'],
    catalysts: [{ id: 'c', title: 'Earnings', date: '2026-10-20', impact: 'high' }],
    linkedEvidence: [{ id: 'e', title: 'Note', type: 'note', date: '2026-09-01' }],
    healthScore: 50,
    ...patch,
});

describe('checkThesis', () => {
    test('a fresh, falsifiable, evidenced thesis with a catalyst scores 100', () => {
        const c = checkThesis(thesis(), NOW);
        assert.strictEqual(c.score, 100);
        assert.ok(c.items.every((i) => i.ok));
        assert.match(c.items[0].detail, /Updated 10 days ago/);
    });

    test('stale review, no counter-case, old evidence, and past catalysts each fail with a reason', () => {
        const c = checkThesis(
            thesis({
                dateUpdated: '2026-01-01',
                bearCase: [],
                linkedEvidence: [{ id: 'e', title: 'Old', type: 'note', date: '2025-01-01' }],
                catalysts: [{ id: 'c', title: 'Past', date: '2026-01-01', impact: 'low' }],
            }),
            NOW,
        );
        assert.strictEqual(c.score, 0);
        assert.deepStrictEqual(c.items.map((i) => i.detail), [
            'Updated 272 days ago (review every 90).',
            'No counter-arguments written.',
            'Newest evidence is 637 days old.',
            'Every tracked catalyst has passed.',
        ]);
    });

    test('for a bear thesis the bull case is the counter-argument', () => {
        const c = checkThesis(thesis({ type: 'bear', bullCase: [], bearCase: ['x'] }), NOW);
        assert.strictEqual(c.items.find((i) => i.id === 'falsifiable')?.ok, false);
    });

    test('recurring catalysts without a date count as upcoming', () => {
        const c = checkThesis(thesis({ catalysts: [{ id: 'c', title: 'China sales', date: 'Monthly', impact: 'high' }] }), NOW);
        assert.strictEqual(c.items.find((i) => i.id === 'catalyst')?.ok, true);
    });

    test('missing dates fail gracefully', () => {
        const c = checkThesis(thesis({ dateUpdated: 'n/a', linkedEvidence: [] }), NOW);
        assert.strictEqual(c.items[0].detail, 'No review date recorded.');
        assert.strictEqual(c.items[2].detail, 'No dated evidence linked.');
        assert.strictEqual(c.score, 50);
    });

    test('custom staleness window', () => {
        assert.strictEqual(checkThesis(thesis({ dateUpdated: '2026-09-01' }), NOW, { staleAfterDays: 14 }).items[0].ok, false);
    });
});
