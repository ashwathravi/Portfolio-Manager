import type { DatedValue } from './periodSummary';

export interface MonthlyExportRow {
    month: string;
    portfolio_value: number;
    portfolio_return_pct: number | '';
    benchmark_value: number | '';
    benchmark_return_pct: number | '';
}

export interface DailyExportRow {
    date: string;
    account: string;
    account_value: number;
    return_pct: number | '';
    cumulative_return_pct: number;
    benchmark: string;
    benchmark_close: number | '';
    benchmark_cumulative_return_pct: number | '';
}

const round2 = (x: number) => Math.round(x * 100) / 100;

const pct = (curr: number, prev: number | undefined): number | '' =>
    prev === undefined || prev === 0 ? '' : Math.round(((curr - prev) / prev) * 10000) / 100;

/**
 * Rows for the Performance › Returns CSV export of the example series: one
 * row per month with value and month-over-month return for the portfolio
 * and its benchmark.
 */
export function monthlyExportRows(
    portfolio: readonly DatedValue[],
    benchmark: readonly DatedValue[],
): MonthlyExportRow[] {
    const bench = new Map(benchmark.map((b) => [b.date, b.value]));
    return portfolio.map((p, i) => {
        const b = bench.get(p.date);
        const bPrev = i > 0 ? bench.get(portfolio[i - 1].date) : undefined;
        return {
            month: p.date.slice(0, 7),
            portfolio_value: round2(p.value),
            portfolio_return_pct: pct(p.value, i > 0 ? portfolio[i - 1].value : undefined),
            benchmark_value: b === undefined ? '' : round2(b),
            benchmark_return_pct: b === undefined ? '' : pct(b, bPrev),
        };
    });
}

/**
 * Rows for the CSV export of real history: one row per snapshot date with
 * the account's value at the close, that session's time-weighted return
 * and the return since the first date, beside the benchmark's.
 */
export function dailyExportRows(
    account: string,
    points: ReadonlyArray<{ date: string; value: number; index: number; stepReturn: number | null }>,
    benchmark: { label: string; values: readonly DatedValue[] } | null,
): DailyExportRow[] {
    const bench = new Map((benchmark?.values ?? []).map((b) => [b.date, b.value]));
    const firstIndex = points[0]?.index ?? 0;
    const firstBench = points[0] ? bench.get(points[0].date) : undefined;
    return points.map((p) => {
        const close = bench.get(p.date);
        return {
            date: p.date,
            account,
            account_value: round2(p.value),
            // Four decimals: a session's return is often a fraction of a percent.
            return_pct: p.stepReturn === null ? '' : Math.round(p.stepReturn * 1_000_000) / 10_000,
            cumulative_return_pct: firstIndex > 0 ? Math.round((p.index / firstIndex - 1) * 10000) / 100 : 0,
            benchmark: benchmark?.label ?? '',
            benchmark_close: close === undefined ? '' : round2(close),
            benchmark_cumulative_return_pct: close === undefined ? '' : pct(close, firstBench),
        };
    });
}
