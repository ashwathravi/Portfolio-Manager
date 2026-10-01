import { test, describe } from 'node:test';
import assert from 'node:assert';
import { monthlyExportRows } from './export';

describe('monthlyExportRows', () => {
    test('emits one row per portfolio month with MoM returns', () => {
        const rows = monthlyExportRows(
            [{ year: 2026, month: 0, value: 100 }, { year: 2026, month: 1, value: 110 }],
            [{ year: 2026, month: 0, value: 200 }, { year: 2026, month: 1, value: 190 }],
        );
        assert.deepStrictEqual(rows, [
            { month: '2026-01', portfolio_value: 100, portfolio_return_pct: '', benchmark_value: 200, benchmark_return_pct: '' },
            { month: '2026-02', portfolio_value: 110, portfolio_return_pct: 10, benchmark_value: 190, benchmark_return_pct: -5 },
        ]);
    });

    test('missing benchmark months are left blank', () => {
        const rows = monthlyExportRows([{ year: 2026, month: 2, value: 50 }], []);
        assert.strictEqual(rows[0].benchmark_value, '');
        assert.strictEqual(rows[0].benchmark_return_pct, '');
    });
});
