import { test, describe } from 'node:test';
import assert from 'node:assert';
import { LANDING_PAGES, isSeededDemoAccount, migrateLandingPage, stripSeededDemoAccounts } from './settingsMigrations';

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
