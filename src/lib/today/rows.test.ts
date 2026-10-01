import { test, describe } from 'node:test';
import assert from 'node:assert';
import { toActivityRows } from '@/lib/portfolio/activity';
import { DEFAULT_THESES } from '@/lib/research/thesis';
import { toTodayActivity, toTodayTheses } from './rows';

describe('toTodayActivity', () => {
    test('maps real transactions to activity rows newest first and drops unknown types', () => {
        const rows = toActivityRows([
            { id: 'a', symbol: 'AAPL', type: 'BUY', quantity: '2', price: '100', timestamp: '2026-09-01T15:00:00Z', portfolioName: 'B' },
            { id: 'b', symbol: null, type: 'deposit', quantity: null, price: null, amount: 500, timestamp: '2026-09-02T15:00:00Z', portfolioName: 'B' },
            { id: 'c', symbol: 'X', type: 'split', quantity: '1', price: '1', timestamp: '2026-09-03T15:00:00Z', portfolioName: 'B' },
        ]);
        assert.deepStrictEqual(toTodayActivity(rows), [
            { id: 'b', type: 'deposit', date: 'Sep 2', ticker: undefined, quantity: undefined, amount: 500, notes: undefined },
            { id: 'a', type: 'buy', date: 'Sep 1', ticker: 'AAPL', quantity: 2, amount: 200, notes: undefined },
        ]);
    });

    test('respects the limit', () => {
        const many = toActivityRows(Array.from({ length: 12 }, (_, i) => ({
            id: `t${i}`, symbol: 'A', type: 'BUY', quantity: '1', price: '1', timestamp: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`, portfolioName: 'B',
        })));
        assert.strictEqual(toTodayActivity(many, 5).length, 5);
    });
});

describe('toTodayTheses', () => {
    test('uses the research store theses (active only), newest first, with links', () => {
        const rows = toTodayTheses(DEFAULT_THESES);
        assert.ok(rows.length > 0);
        assert.ok(rows.every((r) => r.href?.startsWith('/research/thesis/')));
        assert.ok(!rows.some((r) => r.tag === 'META'), 'archived META thesis excluded');
        assert.strictEqual(rows.find((r) => r.tag === 'NVDA')?.conviction, 'High');
    });
});
