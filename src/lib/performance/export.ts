import type { MonthlyValuation } from './periodSummary';

export interface MonthlyExportRow {
    month: string;
    portfolio_value: number;
    portfolio_return_pct: number | '';
    benchmark_value: number | '';
    benchmark_return_pct: number | '';
}

const pct = (curr: number, prev: number | undefined): number | '' =>
    prev === undefined || prev === 0 ? '' : Math.round(((curr - prev) / prev) * 10000) / 100;

/**
 * Rows for the Performance › Returns CSV export: one row per month with
 * value and month-over-month return for the portfolio and its benchmark.
 */
export function monthlyExportRows(
    portfolio: readonly MonthlyValuation[],
    benchmark: readonly MonthlyValuation[],
): MonthlyExportRow[] {
    const bench = new Map(benchmark.map((b) => [`${b.year}-${b.month}`, b.value]));
    return portfolio.map((p, i) => {
        const key = `${p.year}-${p.month}`;
        const prevKey = i > 0 ? `${portfolio[i - 1].year}-${portfolio[i - 1].month}` : null;
        const b = bench.get(key);
        const bPrev = prevKey ? bench.get(prevKey) : undefined;
        return {
            month: `${p.year}-${String(p.month + 1).padStart(2, '0')}`,
            portfolio_value: Math.round(p.value * 100) / 100,
            portfolio_return_pct: pct(p.value, i > 0 ? portfolio[i - 1].value : undefined),
            benchmark_value: b === undefined ? '' : Math.round(b * 100) / 100,
            benchmark_return_pct: b === undefined ? '' : pct(b, bPrev),
        };
    });
}
