import {
    CALENDAR_DAYS_PER_YEAR,
    annualizedReturn,
    dailyReturns,
    maxDrawdown,
    sharpeRatio,
    simpleReturn,
    standardDeviation,
    volatility,
} from './calculations';

export type PeriodKey = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

/**
 * Monthly observation of portfolio / benchmark market value. `month` is the
 * month index (0 = Jan) within `year`. We keep the shape explicit so callers
 * don't have to juggle `Date` timezones in tests.
 */
export interface MonthlyValuation {
    year: number;
    month: number; // 0-11
    value: number;
}

export interface PeriodMetric {
    period: PeriodKey;
    return: number;
    benchmark: number;
    alpha: number;
    sharpe: number;
    maxDrawdown: number;
    volatility: number;
    annualizedReturn: number;
}

const MONTHS_PER_YEAR = 12;

function compareMonth(a: MonthlyValuation, b: MonthlyValuation) {
    return a.year === b.year ? a.month - b.month : a.year - b.year;
}

/**
 * Number of months to include in a period slice given a reference "today"
 * observation. Returns the count of additional observations *before* the
 * reference point, so `slice.length = count + 1`.
 */
function monthsForPeriod(period: PeriodKey, asOf: MonthlyValuation, seriesLength: number): number {
    switch (period) {
        case '1M':
            return 1;
        case '3M':
            return 3;
        case '6M':
            return 6;
        case '1Y':
            return MONTHS_PER_YEAR;
        case 'YTD':
            // Include December of the previous year as the starting value so
            // the period return reflects YTD growth from year-end.
            return asOf.month + 1;
        case 'ALL':
        default:
            return seriesLength - 1;
    }
}

function sliceForPeriod(
    sortedSeries: readonly MonthlyValuation[],
    period: PeriodKey,
): readonly MonthlyValuation[] {
    if (sortedSeries.length < 2) return sortedSeries;
    const asOf = sortedSeries[sortedSeries.length - 1];
    const wanted = monthsForPeriod(period, asOf, sortedSeries.length);
    const start = Math.max(0, sortedSeries.length - 1 - wanted);
    return sortedSeries.slice(start);
}

/**
 * Count calendar days between the first and last observation of a monthly
 * slice. We use the first day of each month so tests are insensitive to
 * local time zones.
 */
export function calendarDaysBetween(start: MonthlyValuation, end: MonthlyValuation): number {
    const startMs = Date.UTC(start.year, start.month, 1);
    const endMs = Date.UTC(end.year, end.month, 1);
    return Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));
}

/**
 * Compute period-level headline metrics for a portfolio series paired with a
 * benchmark series. Both series must share the same length and month/year
 * ordering — missing points short-circuit to zero.
 */
export function computePeriodMetrics(
    portfolio: readonly MonthlyValuation[],
    benchmark: readonly MonthlyValuation[],
    periods: readonly PeriodKey[] = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'],
    options: { riskFreeRate?: number } = {},
): PeriodMetric[] {
    const riskFreeRate = options.riskFreeRate ?? 0;
    const portfolioSorted = [...portfolio].sort(compareMonth);
    const benchmarkSorted = [...benchmark].sort(compareMonth);

    return periods.map((period) => {
        const slice = sliceForPeriod(portfolioSorted, period);
        const benchSlice = sliceForPeriod(benchmarkSorted, period);
        if (slice.length < 2 || benchSlice.length < 2) {
            return {
                period,
                return: 0,
                benchmark: 0,
                alpha: 0,
                sharpe: 0,
                maxDrawdown: 0,
                volatility: 0,
                annualizedReturn: 0,
            };
        }
        const values = slice.map((o) => o.value);
        const benchValues = benchSlice.map((o) => o.value);
        const totalReturn = simpleReturn(values[0], values[values.length - 1]);
        const benchReturn = simpleReturn(benchValues[0], benchValues[benchValues.length - 1]);
        const returns = dailyReturns(values);
        const days = calendarDaysBetween(slice[0], slice[slice.length - 1]);
        return {
            period,
            return: totalReturn,
            benchmark: benchReturn,
            alpha: totalReturn - benchReturn,
            sharpe: sharpeRatio(returns, riskFreeRate, MONTHS_PER_YEAR),
            maxDrawdown: maxDrawdown(values),
            volatility: volatility(returns, MONTHS_PER_YEAR),
            annualizedReturn: annualizedReturn(totalReturn, days),
        };
    });
}

export interface RiskSnapshot {
    volatility: number;
    beta: number;
    sortinoRatio: number;
    /** 95% historical VaR expressed as a *negative* number (loss). */
    valueAtRisk95: number;
}

/**
 * Derive risk metrics from a monthly valuation series plus a benchmark used
 * for beta. Returns zeros when there is insufficient data.
 */
export function computeRiskSnapshot(
    portfolio: readonly MonthlyValuation[],
    benchmark: readonly MonthlyValuation[],
    options: { riskFreeRate?: number } = {},
): RiskSnapshot {
    const riskFreeRate = options.riskFreeRate ?? 0;
    if (portfolio.length < 2 || benchmark.length < 2) {
        return { volatility: 0, beta: 0, sortinoRatio: 0, valueAtRisk95: 0 };
    }
    const portfolioSorted = [...portfolio].sort(compareMonth);
    const benchmarkSorted = [...benchmark].sort(compareMonth);
    const pReturns = dailyReturns(portfolioSorted.map((o) => o.value));
    const bReturns = dailyReturns(benchmarkSorted.map((o) => o.value));
    const annualVol = volatility(pReturns, MONTHS_PER_YEAR);

    // Beta = cov(portfolio, benchmark) / var(benchmark), computed on the
    // overlapping tail of return series.
    const n = Math.min(pReturns.length, bReturns.length);
    let beta = 0;
    if (n >= 2) {
        const pTail = pReturns.slice(pReturns.length - n);
        const bTail = bReturns.slice(bReturns.length - n);
        const pMean = pTail.reduce((a, b) => a + b, 0) / n;
        const bMean = bTail.reduce((a, b) => a + b, 0) / n;
        let cov = 0;
        let varB = 0;
        for (let i = 0; i < n; i++) {
            cov += (pTail[i] - pMean) * (bTail[i] - bMean);
            varB += (bTail[i] - bMean) ** 2;
        }
        cov /= n - 1;
        varB /= n - 1;
        beta = varB === 0 ? 0 : cov / varB;
    }

    // Sortino: annualized mean excess return / downside stddev (zero target).
    const downside = pReturns.filter((r) => r < 0);
    const downsideStd = downside.length >= 2 ? standardDeviation(downside) : 0;
    const downsideAnnual = downsideStd * Math.sqrt(MONTHS_PER_YEAR);
    const meanMonthly = pReturns.reduce((a, b) => a + b, 0) / pReturns.length;
    const annualMean = meanMonthly * MONTHS_PER_YEAR;
    const sortino = downsideAnnual === 0 ? 0 : (annualMean - riskFreeRate) / downsideAnnual;

    // Historical 95% VaR from monthly returns. We take the 5th percentile
    // return and apply it to the latest portfolio value to express VaR in
    // dollars. Positive value => loss. Return it as a negative number for
    // the UI to render directly.
    const sorted = [...pReturns].sort((a, b) => a - b);
    const idx = Math.max(0, Math.floor(0.05 * sorted.length));
    const var95Return = sorted[idx] ?? 0;
    const latestValue = portfolioSorted[portfolioSorted.length - 1].value;
    const valueAtRisk95 = var95Return < 0 ? var95Return * latestValue : 0;

    return {
        volatility: annualVol,
        beta,
        sortinoRatio: sortino,
        valueAtRisk95,
    };
}

// Re-export the calendar constant so consumers don't have to reach into calculations.ts.
export { CALENDAR_DAYS_PER_YEAR };
