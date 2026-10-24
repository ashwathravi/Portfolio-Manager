import {
    CALENDAR_DAYS_PER_YEAR,
    annualizedReturn,
    maxDrawdown,
    simpleReturn,
    volatility,
} from './calculations';
import { getMarketDay, previousTradingDay } from '@/lib/markets/market-hours';

export type PeriodKey = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y' | 'ALL';

/**
 * A value at a date (YYYY-MM-DD). Series are oldest first: daily session
 * closes for real history, month ends for the example series.
 */
export interface DatedValue {
    date: string;
    value: number;
    /**
     * How many periods (sessions, or months) the step into this value
     * spans; 1 when omitted. History that skipped sessions has longer
     * steps, which risk measures scale back to one period.
     */
    periods?: number;
}

/** Observations per year, for annualizing volatility and Sharpe: 12 monthly, 252 daily. */
export const MONTHLY = 12;
export const DAILY = 252;

export interface PeriodMetric {
    period: PeriodKey;
    /** Whether the series reaches back to the period's start; if not, the metrics cover the whole series. */
    covered: boolean;
    /** Date of the observation the period is measured from. */
    start: string | null;
    return: number;
    /** Null when the benchmark has no value at the period's first or last date. */
    benchmark: number | null;
    alpha: number | null;
    /** Null when the period has too few returns to measure risk (see `measuresRisk`). */
    sharpe: number | null;
    maxDrawdown: number;
    volatility: number | null;
    annualizedReturn: number;
}

export interface PeriodOptions {
    periodsPerYear?: number;
    riskFreeRate?: number;
}

const MONTHS_FOR_PERIOD: Partial<Record<PeriodKey, number>> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36 };

function parts(date: string): [number, number, number] {
    const [y, m, d] = date.split('-').map(Number);
    return [y, m, d];
}

function daysInMonth(year: number, month1: number): number {
    return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * `date` moved back `months` calendar months. A month end maps to the
 * earlier month's end (Sep 30 → Aug 31), any other day is clamped to the
 * earlier month's length (Mar 30 → Feb 28).
 */
export function minusMonths(date: string, months: number): string {
    const [y, m, d] = parts(date);
    const index = y * 12 + (m - 1) - months;
    const year = Math.floor(index / 12);
    const month1 = (index % 12) + 1;
    const length = daysInMonth(year, month1);
    const day = d >= daysInMonth(y, m) ? length : Math.min(d, length);
    return `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The date a period is measured from (the last observation on or before it), or null for ALL. */
export function periodStartTarget(asOf: string, period: PeriodKey): string | null {
    if (period === 'ALL') return null;
    if (period === 'YTD') return `${parts(asOf)[0] - 1}-12-31`;
    return minusMonths(asOf, MONTHS_FOR_PERIOD[period] ?? 0);
}

function sortByDate(series: readonly DatedValue[]): DatedValue[] {
    return [...series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * How far before a period's start its first observation may be: a weekend
 * and a holiday, with room to spare. An older one means the history has a
 * gap across the start, and measuring from it would pass a longer span off
 * as the period.
 */
export const MAX_BASELINE_GAP_DAYS = 7;

/**
 * The observations a period covers: from the last one on or before its
 * start to the newest. A series that doesn't reach back to the start, or
 * whose last observation before it is more than MAX_BASELINE_GAP_DAYS
 * older, doesn't cover the period: it comes back whole, `covered: false`.
 */
export function sliceForPeriod(
    sortedSeries: readonly DatedValue[],
    period: PeriodKey,
): { points: readonly DatedValue[]; covered: boolean } {
    if (sortedSeries.length < 2) return { points: sortedSeries, covered: false };
    const target = periodStartTarget(sortedSeries[sortedSeries.length - 1].date, period);
    if (target === null) return { points: sortedSeries, covered: true };
    let start = -1;
    for (let i = 0; i < sortedSeries.length && sortedSeries[i].date <= target; i++) start = i;
    if (start < 0) return { points: sortedSeries, covered: false };
    const baseline = sortedSeries[start];
    if (calendarDaysBetween(baseline, { date: target, value: 0 }) > MAX_BASELINE_GAP_DAYS) {
        return { points: sortedSeries, covered: false };
    }
    return { points: sortedSeries.slice(start), covered: true };
}

/** Calendar days between two observations. */
export function calendarDaysBetween(start: DatedValue, end: DatedValue): number {
    const [sy, sm, sd] = parts(start.date);
    const [ey, em, ed] = parts(end.date);
    return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / (1000 * 60 * 60 * 24));
}

/** Fewest returns, over at least this many calendar days, that annualized risk is measured from. */
export const MIN_RISK_RETURNS = 3;
export const MIN_RISK_DAYS = 28;

/**
 * Whether a slice has enough history for volatility, Sharpe and Sortino:
 * a handful of daily returns annualizes into numbers (a Sharpe of 120)
 * that read as precise but are noise.
 */
export function measuresRisk(slice: readonly DatedValue[]): boolean {
    return slice.length - 1 >= MIN_RISK_RETURNS
        && calendarDaysBetween(slice[0], slice[slice.length - 1]) >= MIN_RISK_DAYS;
}

/**
 * The benchmark's return over the same dates as a portfolio slice, or null
 * when it has no value at either end.
 */
function benchmarkReturn(benchmark: ReadonlyMap<string, number>, slice: readonly DatedValue[]): number | null {
    const first = benchmark.get(slice[0].date);
    const last = benchmark.get(slice[slice.length - 1].date);
    if (first === undefined || last === undefined || !(first > 0)) return null;
    return simpleReturn(first, last);
}

/**
 * Per-period returns for risk measures. A step spanning n periods is
 * scaled to one (r / √n: a random walk's variance grows with time), so a
 * missed session or month doesn't read as one big daily or monthly move;
 * the mean return per period is the total over all the periods.
 */
export function periodReturns(slice: readonly DatedValue[]): { scaled: number[]; meanPerPeriod: number } {
    const scaled: number[] = [];
    let total = 0;
    let periods = 0;
    for (let i = 1; i < slice.length; i++) {
        const prev = slice[i - 1].value;
        const r = prev === 0 ? 0 : slice[i].value / prev - 1;
        const n = Math.max(1, slice[i].periods ?? 1);
        scaled.push(r / Math.sqrt(n));
        total += r;
        periods += n;
    }
    return { scaled, meanPerPeriod: periods > 0 ? total / periods : 0 };
}

/** Annualized Sharpe ratio from `periodReturns`; 0 for a series without volatility. */
function sharpeFrom(scaled: readonly number[], meanPerPeriod: number, riskFreeRate: number, periodsPerYear: number): number {
    if (scaled.length < 2) return 0;
    const vol = volatility(scaled, periodsPerYear);
    if (vol === 0) return 0;
    return (meanPerPeriod * periodsPerYear - riskFreeRate) / vol;
}

/**
 * Period-level headline metrics for a portfolio series and a benchmark
 * observed on the same dates. Volatility and Sharpe are annualized with
 * `periodsPerYear` (monthly by default).
 */
export function computePeriodMetrics(
    portfolio: readonly DatedValue[],
    benchmark: readonly DatedValue[],
    periods: readonly PeriodKey[] = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'],
    options: PeriodOptions = {},
): PeriodMetric[] {
    const riskFreeRate = options.riskFreeRate ?? 0;
    const periodsPerYear = options.periodsPerYear ?? MONTHLY;
    const sorted = sortByDate(portfolio);
    const bench = new Map(benchmark.map((b) => [b.date, b.value]));

    return periods.map((period) => {
        const { points: slice, covered } = sliceForPeriod(sorted, period);
        if (slice.length < 2) {
            return {
                period,
                covered: false,
                start: slice[0]?.date ?? null,
                return: 0,
                benchmark: null,
                alpha: null,
                sharpe: null,
                maxDrawdown: 0,
                volatility: null,
                annualizedReturn: 0,
            };
        }
        const values = slice.map((o) => o.value);
        const totalReturn = simpleReturn(values[0], values[values.length - 1]);
        const benchReturn = benchmarkReturn(bench, slice);
        const { scaled, meanPerPeriod } = periodReturns(slice);
        const days = calendarDaysBetween(slice[0], slice[slice.length - 1]);
        const risk = measuresRisk(slice);
        return {
            period,
            covered,
            start: slice[0].date,
            return: totalReturn,
            benchmark: benchReturn,
            alpha: benchReturn === null ? null : totalReturn - benchReturn,
            sharpe: risk ? sharpeFrom(scaled, meanPerPeriod, riskFreeRate, periodsPerYear) : null,
            maxDrawdown: maxDrawdown(values),
            volatility: risk ? volatility(scaled, periodsPerYear) : null,
            annualizedReturn: annualizedReturn(totalReturn, days),
        };
    });
}

export interface MonthReturn {
    year: number;
    /** 0 = Jan. */
    month: number;
    return: number;
    /** Set when the return isn't measured from the month before's close: the date it is measured from. */
    from?: string;
    /** Set when the return doesn't run to the month's close (the month so far, or a gap): the date it runs to. */
    to?: string;
}

/**
 * The last trading session of `date`'s month; before the market
 * calendar's first year, its last weekday.
 */
export function lastSessionOfMonth(date: string): string {
    const [y, m] = parts(date);
    const last = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
    try {
        return getMarketDay(last).isTradingDay ? last : previousTradingDay(last);
    } catch {
        const at = new Date(`${last}T12:00:00Z`);
        while (at.getUTCDay() === 0 || at.getUTCDay() === 6) at.setUTCDate(at.getUTCDate() - 1);
        return at.toISOString().slice(0, 10);
    }
}

/** Whether `date` is its month's close: on or after the month's last session (a month-end date is). */
function isMonthClose(date: string): boolean {
    return date >= lastSessionOfMonth(date);
}

function monthBefore(date: string): string {
    const [y, m] = parts(date);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Month-by-month returns: each month's last value over the month before's
 * last. A return that doesn't run from the month before's close to the
 * month's own says so: `from` when it starts elsewhere (the series starts
 * mid-month, or skipped the month before or its close), `to` when it ends
 * before the month's close (the month so far, or the history stops). A
 * series that starts on its month's last observation has no return for
 * that month.
 */
export function monthlyReturns(series: readonly DatedValue[]): MonthReturn[] {
    const sorted = sortByDate(series);
    if (sorted.length < 2) return [];
    const monthEnds: DatedValue[] = [];
    for (const point of sorted) {
        const last = monthEnds[monthEnds.length - 1];
        if (last && last.date.slice(0, 7) === point.date.slice(0, 7)) monthEnds[monthEnds.length - 1] = point;
        else monthEnds.push(point);
    }
    const base = sorted[0];
    const out: MonthReturn[] = [];
    for (let i = 0; i < monthEnds.length; i++) {
        const current = monthEnds[i];
        if (i === 0 && current.date === base.date) continue;
        const previous = i === 0 ? base : monthEnds[i - 1];
        const [year, month1] = parts(current.date);
        const fromClose = previous.date.slice(0, 7) === monthBefore(current.date) && isMonthClose(previous.date);
        out.push({
            year,
            month: month1 - 1,
            return: previous.value === 0 ? 0 : current.value / previous.value - 1,
            ...(fromClose ? {} : { from: previous.date }),
            ...(isMonthClose(current.date) ? {} : { to: current.date }),
        });
    }
    return out;
}

export interface RiskSnapshot {
    volatility: number;
    beta: number;
    sortinoRatio: number;
    /** 95% historical VaR expressed as a *negative* number (loss). */
    valueAtRisk95: number;
}

/**
 * Derive risk metrics from a valuation series plus a benchmark used for
 * beta (paired by date). Returns zeros when there is insufficient data.
 */
export function computeRiskSnapshot(
    portfolio: readonly DatedValue[],
    benchmark: readonly DatedValue[],
    options: PeriodOptions = {},
): RiskSnapshot {
    const riskFreeRate = options.riskFreeRate ?? 0;
    const periodsPerYear = options.periodsPerYear ?? MONTHLY;
    if (portfolio.length < 2) {
        return { volatility: 0, beta: 0, sortinoRatio: 0, valueAtRisk95: 0 };
    }
    const portfolioSorted = sortByDate(portfolio);
    const { scaled: pReturns, meanPerPeriod } = periodReturns(portfolioSorted);
    const annualVol = volatility(pReturns, periodsPerYear);

    // Beta = cov(portfolio, benchmark) / var(benchmark), over the steps
    // where the benchmark has a value at both ends, scaled alike.
    const bench = new Map(benchmark.map((b) => [b.date, b.value]));
    const pairs: Array<[number, number]> = [];
    for (let i = 1; i < portfolioSorted.length; i++) {
        const b0 = bench.get(portfolioSorted[i - 1].date);
        const b1 = bench.get(portfolioSorted[i].date);
        const n = Math.max(1, portfolioSorted[i].periods ?? 1);
        if (b0 !== undefined && b1 !== undefined && b0 > 0) pairs.push([pReturns[i - 1], (b1 / b0 - 1) / Math.sqrt(n)]);
    }
    const n = pairs.length;
    let beta = 0;
    if (n >= 2) {
        const pMean = pairs.reduce((a, [p]) => a + p, 0) / n;
        const bMean = pairs.reduce((a, [, b]) => a + b, 0) / n;
        let cov = 0;
        let varB = 0;
        for (const [p, b] of pairs) {
            cov += (p - pMean) * (b - bMean);
            varB += (b - bMean) ** 2;
        }
        cov /= n - 1;
        varB /= n - 1;
        beta = varB === 0 ? 0 : cov / varB;
    }

    // Sortino: annualized mean excess return / downside deviation (zero
    // target). Downside deviation is the root-mean-square of below-target
    // returns over *all* periods (target semideviation). Taking the
    // standard deviation of only the losing months understated risk —
    // two similar losses gave a near-zero spread and a Sortino of 35+.
    const downsideSq = pReturns.reduce((sum, r) => sum + (r < 0 ? r * r : 0), 0);
    const downsideDev = pReturns.length > 0 ? Math.sqrt(downsideSq / pReturns.length) : 0;
    const downsideAnnual = downsideDev * Math.sqrt(periodsPerYear);
    const annualMean = meanPerPeriod * periodsPerYear;
    const sortino = downsideAnnual === 0 ? 0 : (annualMean - riskFreeRate) / downsideAnnual;

    // Historical 95% VaR from per-period returns. We take the 5th
    // percentile return and apply it to the latest portfolio value to
    // express VaR in dollars, as a negative number for the UI.
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
