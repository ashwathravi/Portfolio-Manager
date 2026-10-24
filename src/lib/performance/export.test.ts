import { test, describe } from 'node:test';
import assert from 'node:assert';
import { dailyExportRows, monthlyExportRows } from './export';

describe('monthlyExportRows', () => {
    test('emits one row per portfolio month with MoM returns', () => {
        const rows = monthlyExportRows(
            [{ date: '2026-01-31', value: 100 }, { date: '2026-02-28', value: 110 }],
            [{ date: '2026-01-31', value: 200 }, { date: '2026-02-28', value: 190 }],
        );
        assert.deepStrictEqual(rows, [
            { month: '2026-01', portfolio_value: 100, portfolio_return_pct: '', benchmark_value: 200, benchmark_return_pct: '' },
            { month: '2026-02', portfolio_value: 110, portfolio_return_pct: 10, benchmark_value: 190, benchmark_return_pct: -5 },
        ]);
    });

    test('missing benchmark months are left blank', () => {
        const rows = monthlyExportRows([{ date: '2026-03-31', value: 50 }], []);
        assert.strictEqual(rows[0].benchmark_value, '');
        assert.strictEqual(rows[0].benchmark_return_pct, '');
    });
});

describe('dailyExportRows', () => {
    const points = [
        { date: '2026-10-19', value: 7000, index: 100, stepReturn: null },
        { date: '2026-10-20', value: 12600, index: 100 * (1 + 600 / 7000), stepReturn: 600 / 7000 },
        { date: '2026-10-21', value: 10600, index: 100 * (1 + 600 / 7000), stepReturn: 0 },
    ];

    test('one row per date: value, session and cumulative return, and the benchmark', () => {
        const rows = dailyExportRows('Main Portfolio', points, {
            label: 'S&P 500 (SPY)',
            values: [{ date: '2026-10-19', value: 500 }, { date: '2026-10-20', value: 510 }, { date: '2026-10-21', value: 515.1 }],
        });
        assert.deepStrictEqual(rows, [
            { date: '2026-10-19', account: 'Main Portfolio', account_value: 7000, return_pct: '', cumulative_return_pct: 0, benchmark: 'S&P 500 (SPY)', benchmark_close: 500, benchmark_cumulative_return_pct: 0 },
            { date: '2026-10-20', account: 'Main Portfolio', account_value: 12600, return_pct: 8.5714, cumulative_return_pct: 8.57, benchmark: 'S&P 500 (SPY)', benchmark_close: 510, benchmark_cumulative_return_pct: 2 },
            { date: '2026-10-21', account: 'Main Portfolio', account_value: 10600, return_pct: 0, cumulative_return_pct: 8.57, benchmark: 'S&P 500 (SPY)', benchmark_close: 515.1, benchmark_cumulative_return_pct: 3.02 },
        ]);
    });

    test('without a benchmark its columns are blank', () => {
        const [row] = dailyExportRows('All accounts', points.slice(0, 1), null);
        assert.strictEqual(row.benchmark, '');
        assert.strictEqual(row.benchmark_close, '');
        assert.strictEqual(row.benchmark_cumulative_return_pct, '');
    });
});
