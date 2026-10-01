import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    activityAccounts,
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

    test('summarizeActivity counts buys and sells and distinct accounts', () => {
        const s = summarizeActivity(toActivityRows(rows));
        assert.deepStrictEqual(s, { count: 4, buyCount: 1, sellCount: 1, boughtUsd: 1705, soldUsd: 840, accounts: 2 });
    });

    test('summarizeActivity on no rows is all zeros', () => {
        assert.deepStrictEqual(summarizeActivity([]), { count: 0, buyCount: 0, sellCount: 0, boughtUsd: 0, soldUsd: 0, accounts: 0 });
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
