import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildAccountRows, summarizeAccounts, type AccountInput } from './accounts';

const accounts: AccountInput[] = [
    {
        id: 'p1',
        name: 'Brokerage',
        cashBalance: 1000,
        updatedAt: '2026-09-01T00:00:00Z',
        holdings: [
            { symbol: 'aapl', quantity: '10', avgCost: '100', currentPrice: 150 },
            { symbol: 'MSFT', quantity: '2', avgCost: '300', currentPrice: null, marketValue: 700 },
        ],
    },
    { id: 'p2', name: 'Roth IRA', cashBalance: null, holdings: [{ symbol: 'VTI', quantity: 5, avgCost: 200 }] },
    { id: 'p3', name: 'Empty', cashBalance: 0, holdings: [] },
];

describe('portfolio accounts', () => {
    test('buildAccountRows totals invested, cash, and cost per account', () => {
        const rows = buildAccountRows(accounts);
        const brokerage = rows.find((r) => r.id === 'p1');
        assert.strictEqual(brokerage?.investedUsd, 2200);
        assert.strictEqual(brokerage?.cashUsd, 1000);
        assert.strictEqual(brokerage?.totalUsd, 3200);
        assert.strictEqual(brokerage?.costBasisUsd, 1600);
        assert.strictEqual(brokerage?.unrealizedPct, 37.5);
        assert.strictEqual(brokerage?.positions, 2);
        assert.strictEqual(brokerage?.updatedAt, '2026-09-01T00:00:00.000Z');
    });

    test('falls back to cost when no price or market value is cached', () => {
        const roth = buildAccountRows(accounts).find((r) => r.id === 'p2');
        assert.strictEqual(roth?.totalUsd, 1000);
        assert.strictEqual(roth?.unrealizedPct, 0);
    });

    test('live quotes override cached prices (case-insensitive symbols)', () => {
        const rows = buildAccountRows(accounts, { AAPL: 200, VTI: 220 });
        assert.strictEqual(rows.find((r) => r.id === 'p1')?.investedUsd, 2700);
        assert.strictEqual(rows.find((r) => r.id === 'p2')?.totalUsd, 1100);
    });

    test('rows are sorted by total value and carry their share of the whole', () => {
        const rows = buildAccountRows(accounts);
        assert.deepStrictEqual(rows.map((r) => r.id), ['p1', 'p2', 'p3']);
        assert.strictEqual(rows[0].sharePct, 76.2);
        assert.strictEqual(rows[2].sharePct, 0);
        assert.strictEqual(rows[2].unrealizedPct, null);
    });

    test('summarizeAccounts adds up accounts, positions, value, and cash', () => {
        assert.deepStrictEqual(summarizeAccounts(buildAccountRows(accounts)), {
            accounts: 3,
            positions: 3,
            totalUsd: 4200,
            cashUsd: 1000,
        });
    });

    test('no accounts means an all-zero summary', () => {
        assert.deepStrictEqual(summarizeAccounts(buildAccountRows([])), { accounts: 0, positions: 0, totalUsd: 0, cashUsd: 0 });
    });
});
