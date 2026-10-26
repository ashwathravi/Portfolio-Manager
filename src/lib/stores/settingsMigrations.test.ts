import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    LANDING_PAGES,
    SEEDED_EMPLOYER_SYMBOLS,
    isSeededDemoAccount,
    migrateLandingPage,
    stripSeededDemoAccounts,
    unseedEmployerStock,
} from './settingsMigrations';

describe('settings migrations (v15)', () => {
    test('current landing pages are kept as-is', () => {
        for (const page of LANDING_PAGES) assert.strictEqual(migrateLandingPage(page), page);
    });

    test('retired landing pages map to their replacements', () => {
        assert.strictEqual(migrateLandingPage('/analytics'), '/performance/behaviour');
        assert.strictEqual(migrateLandingPage('/portfolios'), '/portfolios/holdings');
        assert.strictEqual(migrateLandingPage('/portfolios/trade-log'), '/portfolios/holdings');
    });

    test('unknown or malformed values fall back to Today', () => {
        assert.strictEqual(migrateLandingPage('/nope'), '/');
        assert.strictEqual(migrateLandingPage(undefined), '/');
        assert.strictEqual(migrateLandingPage(42), '/');
    });

    test('regression: the three seeded example brokerage accounts are removed', () => {
        const kept = stripSeededDemoAccounts([
            { id: 'fidelity', accountMask: '****1234', provider: 'manual' },
            { id: 'vanguard', accountMask: '****5678' },
            { id: 'ibkr', accountMask: '****9012', provider: 'manual' },
            { id: 'plaid-1', accountMask: '****1111', provider: 'plaid' },
        ]);
        assert.deepStrictEqual(kept.map((a) => a.id), ['plaid-1']);
    });

    test('real accounts that reuse a seeded id are kept', () => {
        assert.strictEqual(isSeededDemoAccount({ id: 'fidelity', accountMask: '****7777', provider: 'manual' }), false);
        assert.strictEqual(isSeededDemoAccount({ id: 'fidelity', accountMask: '****1234', provider: 'plaid' }), false);
    });

    test('stripSeededDemoAccounts tolerates undefined', () => {
        assert.deepStrictEqual(stripSeededDemoAccounts(undefined), []);
    });
});

describe('settings migrations (v16)', () => {
    const labels = { planLabel: 'Employer stock de-risking', trimBandLabel: 'Employer-stock trim band' };
    const seededBand = { id: 'sell-goog-employer-cap', type: 'allocation_cap', label: 'GOOG employer-stock trim band', symbol: 'GOOG', thresholdPct: 25 };
    const staleRule = { id: 'sell-thesis-stale', type: 'stale_thesis', label: 'Review stale active theses' };
    const seeded = () => ({
        employerStockPlan: { id: 'goog-derisk-v1', label: 'GOOG employer stock de-risking', symbols: [...SEEDED_EMPLOYER_SYMBOLS], state: 'draft', targetAllocationPct: 20 },
        sellDisciplineRules: [{ ...seededBand }, { ...staleRule }],
        churnPolicy: { windowDays: 30 },
    });

    test('regression: the seeded GOOG employer stock and trim band are no one\'s employer until named', () => {
        const migrated = unseedEmployerStock(seeded(), labels);
        assert.deepStrictEqual(migrated.employerStockPlan.symbols, []);
        assert.strictEqual(migrated.employerStockPlan.label, 'Employer stock de-risking');
        assert.strictEqual(migrated.employerStockPlan.targetAllocationPct, 20);
        assert.deepStrictEqual(migrated.sellDisciplineRules[0], {
            id: 'sell-goog-employer-cap', type: 'allocation_cap', label: 'Employer-stock trim band', thresholdPct: 25,
        });
        assert.ok(!('symbol' in migrated.sellDisciplineRules[0]));
        assert.deepStrictEqual(migrated.sellDisciplineRules[1], staleRule);
        assert.deepStrictEqual(migrated.churnPolicy, { windowDays: 30 });
    });

    test('a plan the user activated was a choice about GOOG, and stays with its band', () => {
        const active = { ...seeded(), employerStockPlan: { ...seeded().employerStockPlan, state: 'active' } };
        assert.deepStrictEqual(unseedEmployerStock(active, labels), active);
    });

    test('what the user changed stays: other tickers, a renamed band, a renamed plan', () => {
        const msft = { ...seeded(), employerStockPlan: { ...seeded().employerStockPlan, symbols: ['MSFT'] } };
        assert.deepStrictEqual(unseedEmployerStock(msft, labels), msft);

        const renamed = {
            ...seeded(),
            employerStockPlan: { ...seeded().employerStockPlan, symbols: ['googl', 'GOOG'], label: 'My Alphabet plan' },
            sellDisciplineRules: [{ ...seededBand, label: 'Alphabet band' }],
        };
        const migrated = unseedEmployerStock(renamed, labels);
        assert.deepStrictEqual(migrated.employerStockPlan.symbols, []);
        assert.strictEqual(migrated.employerStockPlan.label, 'My Alphabet plan');
        assert.deepStrictEqual(migrated.sellDisciplineRules, [{ ...seededBand, label: 'Alphabet band' }]);
    });

    test('without a stored plan, only the seeded band changes', () => {
        const migrated = unseedEmployerStock({ sellDisciplineRules: [{ ...seededBand }] }, labels);
        assert.ok(!('employerStockPlan' in migrated));
        assert.strictEqual(migrated.sellDisciplineRules[0].label, 'Employer-stock trim band');
        assert.deepStrictEqual(unseedEmployerStock({}, labels), {});
    });
});
