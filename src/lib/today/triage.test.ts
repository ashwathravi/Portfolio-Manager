import { test, describe } from 'node:test';
import assert from 'node:assert';
import type { RiskPolicyNextAction } from '@/lib/risk-policy';
import type { Thesis } from '@/lib/research/thesis';
import { buildTriage } from './triage';

const NOW = Date.parse('2026-09-30T12:00:00Z');

const action = (id: string, status: RiskPolicyNextAction['status'], label = id): RiskPolicyNextAction =>
    ({ id, label, detail: `${label} detail`, href: '/portfolios/holdings', status }) as RiskPolicyNextAction;

const thesis = (id: string, dateUpdated: string, status: Thesis['status'] = 'active'): Thesis => ({
    id, ticker: id.toUpperCase(), companyName: id, title: id, description: '', type: 'bull', status,
    conviction: 'HIGH', targetPrice: 1, timeHorizon: '', dateCreated: dateUpdated, dateUpdated, tags: [],
    hypothesis: '', bullCase: [], bearCase: [], catalysts: [], linkedEvidence: [], healthScore: 0,
});

const base = { policyActions: [], theses: [], isSampleThesis: () => false, reviewDue: false, now: NOW };

describe('buildTriage', () => {
    test('nothing to do yields an empty list', () => {
        assert.deepStrictEqual(buildTriage(base), []);
    });

    test('ranks breaches, then warnings, then info, keeping input order within a rank', () => {
        const items = buildTriage({
            ...base,
            policyActions: [action('top3', 'missing_data'), action('single_name', 'watch'), action('options', 'breached'), action('ok', 'inside')],
            reviewDue: true,
        });
        assert.deepStrictEqual(items.map((i) => [i.id, i.severity]), [
            ['policy:options', 'breach'],
            ['policy:single_name', 'warn'],
            ['policy:top3', 'info'],
            ['review:this-week', 'info'],
        ]);
        assert.match(items[2].detail, /^Missing data · /);
    });

    test('stale active theses become re-underwrite prompts; fresh and archived ones do not', () => {
        const items = buildTriage({
            ...base,
            theses: [thesis('nvda', '2026-01-01'), thesis('msft', '2026-09-20'), thesis('meta', '2025-01-01', 'archived')],
            isSampleThesis: (t) => t.id === 'nvda',
        });
        assert.deepStrictEqual(items.map((i) => i.id), ['thesis:nvda']);
        assert.strictEqual(items[0].title, 'Re-underwrite the NVDA thesis');
        assert.strictEqual(items[0].href, '/research/thesis/NVDA');
        assert.strictEqual(items[0].sample, true);
    });

    test('sample flags flow from the inputs', () => {
        const items = buildTriage({ ...base, policyActions: [action('x', 'breached')], policyIsSample: true, reviewDue: true, reviewIsSample: true });
        assert.ok(items.every((i) => i.sample));
    });

    test('respects the limit', () => {
        const many = Array.from({ length: 10 }, (_, i) => action(`a${i}`, 'watch'));
        assert.strictEqual(buildTriage({ ...base, policyActions: many }, 3).length, 3);
    });
});
