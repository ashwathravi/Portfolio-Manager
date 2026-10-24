import type { DatedValue } from './periodSummary';

/**
 * Monthly equity curve used on the performance deep-dive page. Until a live
 * data source is wired up (AR-11/AR-12), this serves as the source of truth
 * for derived metrics so the numbers shown are internally consistent across
 * charts, Stat cards, and the period-breakdown table.
 */
// Example monthly returns (%) for the portfolio and the S&P 500 benchmark,
// oldest first. Shaped like a real concentrated growth book: mostly up,
// with genuine drawdowns (a -6.8% month inside a two-month slide), so the
// derived Sharpe, Sortino, and max drawdown look plausible.
const PORTFOLIO_RETURNS_PCT = [1.9, 3.1, -2.4, 2.7, 3.8, -4.6, 3.2, 4.1, -1.2, -6.8, 5.3, 4.9, 1.4, 2.6, -3.1, 2.2, 3.9, -1.7, 2.8, 1.1, -2.9, 3.6, 2.4, 1.8];
const BENCHMARK_RETURNS_PCT = [1.2, 1.6, -1.5, 1.9, 2.1, -2.8, 2.0, 2.4, -0.9, -4.1, 3.6, 2.7, 0.9, 1.5, -1.8, 1.4, 2.2, -0.8, 1.6, 0.7, -1.9, 2.3, 1.2, 1.1];

/**
 * Builds the example series so the last point is the most recent complete
 * month before `now` (UTC). Deterministic within a calendar month, so the
 * server render and hydration agree.
 */
export function buildMonthlySamples(now: number): Array<{ year: number; month: number; account: number; benchmark: number; deployed: number }> {
    const d = new Date(now);
    let year = d.getUTCFullYear();
    let month = d.getUTCMonth() - 1; // last complete month
    if (month < 0) {
        month = 11;
        year -= 1;
    }
    const points = PORTFOLIO_RETURNS_PCT.length + 1;
    const startIndex = year * 12 + month - (points - 1);
    let account = 100_000;
    let benchmark = 100_000;
    const out = [];
    for (let i = 0; i < points; i++) {
        if (i > 0) {
            account *= 1 + PORTFOLIO_RETURNS_PCT[i - 1] / 100;
            benchmark *= 1 + BENCHMARK_RETURNS_PCT[i - 1] / 100;
        }
        const idx = startIndex + i;
        out.push({
            year: Math.floor(idx / 12),
            month: idx % 12,
            account: Math.round(account),
            benchmark: Math.round(benchmark),
            deployed: Math.round(account * (0.55 + 0.3 * (i / (points - 1)))),
        });
    }
    return out;
}

export interface ExampleMonthlySeries {
    portfolio: DatedValue[];
    benchmark: DatedValue[];
}

/** The last day of `month` (0 = Jan) as YYYY-MM-DD. */
export function monthEndDate(year: number, month: number): string {
    const day = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

let monthlySeriesCache: { monthIndex: number; series: ExampleMonthlySeries } | null = null;

/**
 * Example portfolio and S&P 500 month-end values ending at the last
 * complete month before `now`. Memoised per UTC month, so callers get the same
 * arrays all month; a long-running server process moves to the new month
 * instead of rendering the month it loaded this module, which made the
 * server render and hydration disagree.
 */
export function getExampleMonthlySeries(now: number = Date.now()): ExampleMonthlySeries {
    const d = new Date(now);
    const monthIndex = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (monthlySeriesCache?.monthIndex !== monthIndex) {
        const samples = buildMonthlySamples(now);
        monthlySeriesCache = {
            monthIndex,
            series: {
                portfolio: samples.map((s) => ({ date: monthEndDate(s.year, s.month), value: s.account })),
                benchmark: samples.map((s) => ({ date: monthEndDate(s.year, s.month), value: s.benchmark })),
            },
        };
    }
    return monthlySeriesCache.series;
}
