import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    activityAccounts,
    activityChurn,
    filterActivity,
    normalizeSide,
    summarizeActivity,
    toActivityRows,
    type TransactionRowInput,
} from './activity';

const rows: TransactionRowInput[] = [
    { id: 't1', symbol: 'aapl', type: 'BUY', quantity: '10', price: '170.5', timestamp: '2026-02-05T15:00:00Z', portfolioName: 'Brokerage' },
    { id: 't2', symbol: 'TSLA', type: 'sell', quantity: '4', price: '210', timestamp: new Date('2026-02-06T15:00:00Z'), portfolioName: 'Roth IRA', notes: 'trim' },
    { id: 't3', symbol: null, type: 'deposit', quantity: null, price: null, amount: 5000, timestamp: '2026-02-01T12:00:00Z', portfolioName: 'Brokerage' },
    { id: 't4', symbol: 'MSFT', type: 'dividend', quantity: null, price: null, amount: -12.5, timestamp: '2026-01-15T12:00:00Z', portfolioName: 'Brokerage' },
];

describe('portfolio activity', () => {
    test('normalizeSide maps known types and falls back to OTHER', () => {
        assert.strictEqual(normalizeSide('buy'), 'BUY');
        assert.strictEqual(normalizeSide(' Withdrawal '), 'WITHDRAWAL');
        assert.strictEqual(normalizeSide('split'), 'OTHER');
        assert.strictEqual(normalizeSide('interest'), 'INTEREST');
        assert.strictEqual(normalizeSide('FEE'), 'FEE');
    });

    test('toActivityRows coerces numeric strings, uppercases symbols, and sorts newest first', () => {
        const out = toActivityRows(rows);
        assert.deepStrictEqual(out.map((r) => r.id), ['t2', 't1', 't3', 't4']);
        assert.strictEqual(out[1].symbol, 'AAPL');
        assert.strictEqual(out[1].value, 1705);
        assert.strictEqual(out[0].notes, 'trim');
    });

    test('value falls back to the absolute amount when qty/price are missing', () => {
        const out = toActivityRows(rows);
        assert.strictEqual(out.find((r) => r.id === 't3')?.value, 5000);
        assert.strictEqual(out.find((r) => r.id === 't4')?.value, 12.5);
    });

    test('fees and currency come through; none recorded reads as no fees, in USD', () => {
        const [row] = toActivityRows([{ ...rows[0], fees: '0.02', currency: 'CAD' }]);
        assert.strictEqual(row.fees, 0.02);
        assert.strictEqual(row.currency, 'CAD');
        const [plain] = toActivityRows([rows[0]]);
        assert.strictEqual(plain.fees, null);
        assert.strictEqual(plain.currency, 'USD');
    });

    test('summarizeActivity counts buys and sells and distinct accounts', () => {
        const s = summarizeActivity(toActivityRows(rows));
        assert.deepStrictEqual(s, {
            count: 4,
            buyCount: 1,
            sellCount: 1,
            bought: [{ currency: 'USD', amount: 1705 }],
            sold: [{ currency: 'USD', amount: 840 }],
            accounts: 2,
        });
    });

    test('summarizeActivity on no rows is all zeros', () => {
        assert.deepStrictEqual(summarizeActivity([]), { count: 0, buyCount: 0, sellCount: 0, bought: [], sold: [], accounts: 0 });
    });

    test('regression: amounts in different currencies are totalled apart, USD first', () => {
        // The Codex finding on PR #154: a CAD 100 buy and a USD 100 buy read as $200 bought.
        const trade = (id: string, type: string, currency: string, price: string): TransactionRowInput => ({
            id, symbol: 'SHOP', type, quantity: '1', price, timestamp: '2026-02-05T15:00:00Z', portfolioName: 'Brokerage', currency,
        });
        const s = summarizeActivity(toActivityRows([
            trade('a', 'BUY', 'USD', '100'),
            trade('b', 'BUY', 'EUR', '30'),
            trade('c', 'BUY', 'CAD', '100'),
            trade('d', 'BUY', 'CAD', '50'),
            trade('e', 'SELL', 'CAD', '80'),
        ]));
        assert.deepStrictEqual(s.bought, [{ currency: 'USD', amount: 100 }, { currency: 'CAD', amount: 150 }, { currency: 'EUR', amount: 30 }]);
        assert.deepStrictEqual(s.sold, [{ currency: 'CAD', amount: 80 }]);
    });

    test('regression: activityChurn keeps turnover in the trades\' own currency', () => {
        const trade = (id: string, type: string, currency: string, day: string): TransactionRowInput => ({
            id, symbol: 'SHOP', type, quantity: '1', price: '100', timestamp: `2026-02-${day}T15:00:00Z`, portfolioName: 'Brokerage', currency,
        });
        const churn = activityChurn(toActivityRows([
            trade('a', 'BUY', 'CAD', '02'), trade('b', 'SELL', 'CAD', '03'), trade('c', 'BUY', 'CAD', '04'),
            trade('d', 'BUY', 'USD', '05'), trade('e', 'SELL', 'USD', '06'),
        ]));
        const byCurrency = Object.fromEntries(churn.map((r) => [r.currency, r]));
        assert.strictEqual(byCurrency.CAD?.tradeCount, 3);
        assert.strictEqual(byCurrency.CAD?.turnoverUsd, 300);
        assert.strictEqual(byCurrency.USD?.tradeCount, 2);
        assert.strictEqual(byCurrency.USD?.turnoverUsd, 200);
        // Sorted by churn score, as computeChurnAnalysis sorts its rows.
        assert.ok(churn.every((r, i) => i === 0 || churn[i - 1].churnScore >= r.churnScore));
    });

    test('activityChurn measures every currency over the same window, ending at the latest trade', () => {
        const old = { id: 'o1', symbol: 'SHOP', type: 'BUY', quantity: '1', price: '100', portfolioName: 'B', currency: 'CAD' };
        const churn = activityChurn(toActivityRows([
            { ...old, id: 'o1', timestamp: '2025-01-02T15:00:00Z' },
            { ...old, id: 'o2', type: 'SELL', timestamp: '2025-01-03T15:00:00Z' },
            { ...rows[0], id: 'n1', timestamp: '2026-02-05T15:00:00Z' },
            { ...rows[0], id: 'n2', type: 'SELL', timestamp: '2026-02-06T15:00:00Z' },
        ]));
        // A year-old CAD round trip is outside the 90 days before the latest trade.
        assert.deepStrictEqual(churn.map((r) => [r.symbol, r.currency]), [['AAPL', 'USD']]);
        assert.deepStrictEqual(activityChurn([]), []);
    });

    test('filterActivity by side, account, query, and symbol set', () => {
        const all = toActivityRows(rows);
        assert.deepStrictEqual(filterActivity(all, { side: 'SELL' }).map((r) => r.id), ['t2']);
        assert.deepStrictEqual(filterActivity(all, { account: 'Brokerage' }).map((r) => r.id), ['t1', 't3', 't4']);
        assert.deepStrictEqual(filterActivity(all, { query: 'aap' }).map((r) => r.id), ['t1']);
        assert.deepStrictEqual(filterActivity(all, { query: 'trim' }).map((r) => r.id), ['t2']);
        assert.deepStrictEqual(filterActivity(all, { symbols: ['tsla', 'msft'] }).map((r) => r.id), ['t2', 't4']);
        assert.strictEqual(filterActivity(all, { side: 'ALL', account: 'ALL', query: '' }).length, 4);
    });

    test('activityAccounts lists distinct accounts alphabetically', () => {
        assert.deepStrictEqual(activityAccounts(toActivityRows(rows)), ['Brokerage', 'Roth IRA']);
    });
});
