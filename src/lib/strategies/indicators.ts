/**
 * What a strategy rule can compare (launch item i55): indicators Atlas can
 * work out from the daily bars in its price store, and plain numbers.
 * Fundamentals (P/E and the like) aren't stored, so rules can't use them.
 *
 *   Close       the day's closing price
 *   SMA(n)      simple moving average of the last n closes (2–250)
 *   EMA(n)      exponential moving average of the closes (2–250)
 *   RSI(n)      Wilder's relative strength index, 0–100 (2–100)
 *   Mom(nM)     return over the last n months, in %: 21 trading days a month (1–12)
 *   ADV(n)      average dollar volume (close × volume) over n days (1–250)
 */

export type IndicatorKind = 'close' | 'sma' | 'ema' | 'rsi' | 'mom' | 'adv';

export interface Indicator {
    kind: IndicatorKind;
    /** Days, or months for Mom; 0 for Close. */
    period: number;
}

/** A rule's right-hand side: a number, or another indicator (Close crosses above SMA(50)). */
export type RuleOperand = { kind: 'number'; value: number } | { kind: 'indicator'; indicator: Indicator };

export const TRADING_DAYS_PER_MONTH = 21;

const PERIODS: Record<Exclude<IndicatorKind, 'close'>, [min: number, max: number]> = {
    sma: [2, 250],
    ema: [2, 250],
    rsi: [2, 100],
    mom: [1, 12],
    adv: [1, 250],
};

/** The fields the rule builder offers; any period in range can be typed as a value. */
export const INDICATOR_PRESETS = [
    'Close',
    'SMA(20)',
    'SMA(50)',
    'SMA(200)',
    'EMA(20)',
    'RSI(14)',
    'Mom(1M)',
    'Mom(3M)',
    'Mom(6M)',
    'Mom(12M)',
    'ADV(30)',
] as const;

export function parseIndicator(text: string): Indicator | null {
    const t = text.trim();
    if (/^close$/i.test(t)) return { kind: 'close', period: 0 };
    const mom = /^mom\((\d{1,2})m\)$/i.exec(t);
    const other = /^(sma|ema|rsi|adv)\((\d{1,3})\)$/i.exec(t);
    const kind = mom ? 'mom' : (other?.[1].toLowerCase() as Exclude<IndicatorKind, 'close' | 'mom'> | undefined);
    if (!kind) return null;
    const period = Number(mom ? mom[1] : other![2]);
    const [min, max] = PERIODS[kind];
    return period >= min && period <= max ? { kind, period } : null;
}

export function indicatorLabel({ kind, period }: Indicator): string {
    if (kind === 'close') return 'Close';
    if (kind === 'mom') return `Mom(${period}M)`;
    return `${kind.toUpperCase()}(${period})`;
}

/**
 * A number as people write one in a rule: 30, -2.5, 10%, $5M, 1,000, 2.5B.
 * Percent signs are dropped (Mom and RSI are already in percent), and K, M
 * and B scale by thousands. Null for anything else.
 */
export function parseRuleNumber(text: string): number | null {
    const m = /^\s*([-+]?)\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*([kmb%])?\s*$/i.exec(text);
    if (!m) return null;
    const scale = { k: 1e3, m: 1e6, b: 1e9, '%': 1 }[m[4]?.toLowerCase() as 'k' | 'm' | 'b' | '%'] ?? 1;
    const value = Number(`${m[2].replace(/,/g, '')}${m[3] ?? ''}`) * scale;
    return Number.isFinite(value) ? (m[1] === '-' ? -value : value) : null;
}

export function parseOperand(text: string): RuleOperand | null {
    const indicator = parseIndicator(text);
    if (indicator) return { kind: 'indicator', indicator };
    const value = parseRuleNumber(text);
    return value === null ? null : { kind: 'number', value };
}

/** Earlier bars an indicator needs before it has a value: SMA(50) needs 49. */
export function lookback({ kind, period }: Indicator): number {
    switch (kind) {
        case 'close': return 0;
        case 'sma':
        case 'ema':
        case 'adv': return period - 1;
        case 'rsi': return period;
        case 'mom': return period * TRADING_DAYS_PER_MONTH;
    }
}

export interface IndicatorBar {
    close: number;
    volume: number;
}

/** The indicator for each bar, oldest first; null until it has enough bars. */
export function indicatorSeries(bars: readonly IndicatorBar[], { kind, period }: Indicator): (number | null)[] {
    const closes = bars.map((b) => b.close);
    switch (kind) {
        case 'close': return closes;
        case 'sma': return rollingMean(closes, period);
        case 'adv': return rollingMean(bars.map((b) => b.close * b.volume), period);
        case 'ema': return ema(closes, period);
        case 'rsi': return rsi(closes, period);
        case 'mom': {
            const back = period * TRADING_DAYS_PER_MONTH;
            return closes.map((c, i) => (i >= back && closes[i - back] > 0 ? (c / closes[i - back] - 1) * 100 : null));
        }
    }
}

function rollingMean(values: readonly number[], n: number): (number | null)[] {
    let sum = 0;
    return values.map((v, i) => {
        sum += v;
        if (i >= n) sum -= values[i - n];
        return i >= n - 1 ? sum / n : null;
    });
}

/** Seeded with the simple average of the first n closes. */
function ema(values: readonly number[], n: number): (number | null)[] {
    const k = 2 / (n + 1);
    let prev: number | null = null;
    return values.map((v, i) => {
        if (i < n - 1) return null;
        prev = prev === null ? values.slice(0, n).reduce((a, b) => a + b, 0) / n : v * k + prev * (1 - k);
        return prev;
    });
}

/** Wilder's smoothing; 100 with no losses, 50 with no moves at all. */
function rsi(closes: readonly number[], n: number): (number | null)[] {
    const out: (number | null)[] = closes.map(() => null);
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const up = Math.max(change, 0);
        const down = Math.max(-change, 0);
        if (i <= n) {
            gain += up / n;
            loss += down / n;
            if (i < n) continue;
        } else {
            gain = (gain * (n - 1) + up) / n;
            loss = (loss * (n - 1) + down) / n;
        }
        out[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
    }
    return out;
}
