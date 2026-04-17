/**
 * Performance calculation primitives.
 *
 * All functions are pure and operate on plain numbers / arrays so they can be
 * reused on the server (initial page render) and client (live updates).
 */

/** Number of trading days typically used to annualize daily return series. */
export const TRADING_DAYS_PER_YEAR = 252;

/** Calendar days per year used for time-based annualization. */
export const CALENDAR_DAYS_PER_YEAR = 365;

export interface ValuationPoint {
    /** Portfolio market value at the end of the subperiod. */
    value: number;
    /**
     * Net external cash flow *into* the portfolio during the subperiod
     * (positive for deposits, negative for withdrawals). Defaults to 0.
     */
    cashFlowIn?: number;
}

/**
 * Simple arithmetic return between two scalar values.
 * Returns 0 when `start` is zero to avoid division-by-zero surprises.
 */
export function simpleReturn(start: number, end: number): number {
    if (!Number.isFinite(start) || start === 0) return 0;
    return (end - start) / start;
}

/**
 * Subperiod return that backs out external contributions so the result only
 * reflects investment performance.
 *
 * Assumes cash flows arrive at the *end* of the subperiod (common convention
 * for daily NAV series). If you treat them as beginning-of-period, adjust
 * upstream — the formula here keeps the denominator stable at `start`.
 */
export function periodReturn(
    start: number,
    end: number,
    cashFlowIn = 0,
): number {
    if (!Number.isFinite(start) || start === 0) return 0;
    return (end - cashFlowIn - start) / start;
}

/**
 * Chain-link a series of subperiod returns into a cumulative return.
 *
 * TWR = Π (1 + r_i) - 1
 */
export function chainLinkedReturn(returns: readonly number[]): number {
    if (returns.length === 0) return 0;
    let growth = 1;
    for (const r of returns) {
        growth *= 1 + r;
    }
    return growth - 1;
}

/**
 * Time-weighted return from a series of valuation points. The first entry is
 * treated as the starting value and contributes no subperiod return.
 *
 * This is the standard GIPS-aligned TWR: split the series at each cash flow,
 * compute each subperiod's pure investment return, then chain-link them.
 */
export function twr(points: readonly ValuationPoint[]): number {
    if (points.length < 2) return 0;
    const returns: number[] = [];
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1].value;
        const curr = points[i];
        returns.push(periodReturn(prev, curr.value, curr.cashFlowIn ?? 0));
    }
    return chainLinkedReturn(returns);
}

/**
 * Convert a total return over a given number of calendar days into an
 * annualized equivalent. Returns `totalReturn` when days <= 0 so callers
 * don't have to special-case short histories.
 */
export function annualizedReturn(totalReturn: number, days: number): number {
    if (days <= 0) return totalReturn;
    const years = days / CALENDAR_DAYS_PER_YEAR;
    return Math.pow(1 + totalReturn, 1 / years) - 1;
}

/**
 * Return the excess of a portfolio's return over a benchmark's — the classic
 * "alpha" relative to an index in the same period.
 */
export function excessReturn(portfolio: number, benchmark: number): number {
    return portfolio - benchmark;
}

/**
 * Maximum drawdown of a valuation series: the largest peak-to-trough decline
 * expressed as a *negative* number (0 when the series only goes up).
 */
export function maxDrawdown(values: readonly number[]): number {
    if (values.length === 0) return 0;
    let peak = values[0];
    let maxDd = 0;
    for (const v of values) {
        if (v > peak) peak = v;
        if (peak > 0) {
            const dd = (v - peak) / peak;
            if (dd < maxDd) maxDd = dd;
        }
    }
    return maxDd;
}

/**
 * Sample standard deviation of a return series. Uses Bessel's correction
 * (divide by n-1) so this matches Excel/NumPy's default `STDEV.S`.
 */
export function standardDeviation(returns: readonly number[]): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance);
}

/**
 * Annualized volatility of a return series sampled at `periodsPerYear`
 * (252 for daily trading-day data, 12 for monthly, etc.).
 */
export function volatility(
    returns: readonly number[],
    periodsPerYear = TRADING_DAYS_PER_YEAR,
): number {
    return standardDeviation(returns) * Math.sqrt(periodsPerYear);
}

/**
 * Annualized Sharpe ratio. `riskFreeRate` is the annual rate.
 * Returns 0 when volatility is zero (constant series) so callers don't get
 * `Infinity`/`NaN` into charts.
 */
export function sharpeRatio(
    returns: readonly number[],
    riskFreeRate = 0,
    periodsPerYear = TRADING_DAYS_PER_YEAR,
): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const annualizedMean = mean * periodsPerYear;
    const vol = volatility(returns, periodsPerYear);
    if (vol === 0) return 0;
    return (annualizedMean - riskFreeRate) / vol;
}

/**
 * Daily returns derived from a series of closing values. Output length is
 * `values.length - 1`.
 */
export function dailyReturns(values: readonly number[]): number[] {
    if (values.length < 2) return [];
    const out: number[] = [];
    for (let i = 1; i < values.length; i++) {
        out.push(simpleReturn(values[i - 1], values[i]));
    }
    return out;
}

export interface PeriodSummary {
    totalReturn: number;
    annualizedReturn: number;
    maxDrawdown: number;
    volatility: number;
    sharpeRatio: number;
}

/**
 * Roll up a daily closing-value series into the headline metrics usually shown
 * on a performance page.
 */
export function summarize(
    values: readonly number[],
    options: { days?: number; riskFreeRate?: number; periodsPerYear?: number } = {},
): PeriodSummary {
    if (values.length < 2) {
        return {
            totalReturn: 0,
            annualizedReturn: 0,
            maxDrawdown: 0,
            volatility: 0,
            sharpeRatio: 0,
        };
    }
    const returns = dailyReturns(values);
    const total = simpleReturn(values[0], values[values.length - 1]);
    const days = options.days ?? values.length - 1;
    const periodsPerYear = options.periodsPerYear ?? TRADING_DAYS_PER_YEAR;
    return {
        totalReturn: total,
        annualizedReturn: annualizedReturn(total, days),
        maxDrawdown: maxDrawdown(values),
        volatility: volatility(returns, periodsPerYear),
        sharpeRatio: sharpeRatio(returns, options.riskFreeRate ?? 0, periodsPerYear),
    };
}
