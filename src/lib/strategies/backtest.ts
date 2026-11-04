/**
 * Backtest engine (launch item i55): runs a strategy's rules over daily
 * bars from the price store.
 *
 * How a run works, so the numbers can be checked by hand:
 * - The window starts once every rule has enough history (SMA(200) needs
 *   200 sessions), on the sessions any of the strategy's tickers traded,
 *   and ends at the last stored session. Equity starts at $100,000.
 * - On a check day (the first session, then whenever `rebalanceDays`
 *   calendar days have passed) the rules are read at each ticker's close.
 *   A ticker that passes and isn't held is bought at the next session's
 *   open with up to `maxPositionPct` of that close's equity, as cash
 *   allows; a held ticker that fails is sold at the next open. Only check
 *   days change what's held, apart from stops.
 * - A position is stopped out when a session's low reaches `stopLossPct`
 *   under its entry, at the stop price (or the open, when it opens below).
 * - Long only, fractional shares, no fees, slippage, dividends or taxes:
 *   the result says so beside the numbers.
 * - AND binds tighter than OR: A AND B OR C is (A AND B) OR C. An
 *   indicator without enough history yet fails its rule.
 * - A crossing is an event, so for a ticker already held "crosses above"
 *   reads as "is above" (and "crosses below" as "is below"): Close crosses
 *   above SMA(50) buys on the cross and holds while Close stays above.
 *
 * The Monte Carlo strip resamples the run's daily returns (with
 * replacement, from a seed the definition decides, so a run is
 * repeatable) to show how much of the result rides on the order the days
 * came in.
 */

import {
    indicatorLabel,
    indicatorSeries,
    lookback,
    parseIndicator,
    parseOperand,
    type Indicator,
    type RuleOperand,
} from './indicators';
import type {
    BacktestStats,
    BacktestVerdict,
    MonteCarloCell,
    StrategyBacktest,
    StrategyDefinition,
    StrategyOp,
} from './strategy';

export interface BacktestBar {
    /** YYYY-MM-DD */
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface BacktestTrade {
    symbol: string;
    entryDate: string;
    entryPrice: number;
    exitDate: string;
    exitPrice: number;
    quantity: number;
    pnl: number;
    exitReason: 'rules' | 'stop';
}

export type BacktestOutcome =
    | { ok: true; backtest: StrategyBacktest; trades: BacktestTrade[] }
    | { ok: false; code: 'NO_RULES' | 'INVALID_RULE' | 'NO_SYMBOLS' | 'NO_HISTORY' | 'SHORT_HISTORY'; message: string };

export const INITIAL_CAPITAL = 100_000;
export const BENCHMARK_SYMBOL = 'SPY';
const MONTE_CARLO_PATHS = 1_000;
/** Fewer daily returns than this and Sharpe, Sortino and Monte Carlo say nothing. */
const MIN_RETURNS = 20;
const MIN_TRADES_TO_JUDGE = 10;
const MIN_SESSIONS_TO_JUDGE = 126;
const PERCENTILES = [5, 25, 50, 75, 95] as const;
const DAY_MS = 86_400_000;

interface CompiledRule {
    left: Indicator;
    op: StrategyOp;
    right: RuleOperand;
}

/** The rules as the engine reads them, or the first that it can't. */
export function compileRules(definition: Pick<StrategyDefinition, 'rules'>): { ok: true; rules: CompiledRule[] } | { ok: false; message: string } {
    const rules: CompiledRule[] = [];
    for (const [i, rule] of definition.rules.entries()) {
        const left = parseIndicator(rule.field);
        if (!left) return { ok: false, message: `Rule ${i + 1}: Atlas can't compute "${rule.field}".` };
        const right = parseOperand(rule.value);
        if (!right) return { ok: false, message: `Rule ${i + 1}: "${rule.value}" isn't a number or an indicator.` };
        rules.push({ left, op: rule.op, right });
    }
    return { ok: true, rules };
}

/** Sessions of history the rules need before the first check. */
export function warmupSessions(rules: readonly CompiledRule[]): number {
    let need = 0;
    for (const { left, op, right } of rules) {
        const crosses = op === 'crosses above' || op === 'crosses below' ? 1 : 0;
        need = Math.max(need, lookback(left) + crosses, right.kind === 'indicator' ? lookback(right.indicator) + crosses : 0);
    }
    return need;
}

interface SymbolData {
    bars: BacktestBar[];
    index: Map<string, number>;
    series: Map<string, (number | null)[]>;
}

function prepare(bars: BacktestBar[], rules: readonly CompiledRule[]): SymbolData {
    const series = new Map<string, (number | null)[]>();
    const add = (indicator: Indicator) => {
        const key = indicatorLabel(indicator);
        if (!series.has(key)) series.set(key, indicatorSeries(bars, indicator));
    };
    for (const rule of rules) {
        add(rule.left);
        if (rule.right.kind === 'indicator') add(rule.right.indicator);
    }
    return { bars, index: new Map(bars.map((b, i) => [b.date, i])), series };
}

function ruleHolds(data: SymbolData, i: number, { left, op, right }: CompiledRule): boolean {
    const l = data.series.get(indicatorLabel(left))!;
    const valueAt = (j: number) => (right.kind === 'number' ? right.value : data.series.get(indicatorLabel(right.indicator))![j]);
    const a = l[i];
    const b = valueAt(i);
    if (a == null || b == null) return false;
    switch (op) {
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
        case 'crosses above':
        case 'crosses below': {
            const pa = i > 0 ? l[i - 1] : null;
            const pb = i > 0 ? valueAt(i - 1) : null;
            if (pa == null || pb == null) return false;
            return op === 'crosses above' ? a > b && pa <= pb : a < b && pa >= pb;
        }
    }
}

/** AND binds tighter than OR. */
function rulesHold(data: SymbolData, i: number, rules: readonly CompiledRule[], conjunctions: readonly string[]): boolean {
    let any = false;
    let all = true;
    rules.forEach((rule, k) => {
        all = all && ruleHolds(data, i, rule);
        if (k === rules.length - 1 || conjunctions[k] === 'OR') {
            any = any || all;
            all = true;
        }
    });
    return any;
}

interface Position {
    quantity: number;
    entryPrice: number;
    entryDate: string;
}

export function runBacktest(
    definition: StrategyDefinition,
    barsBySymbol: Readonly<Record<string, readonly BacktestBar[]>>,
    { benchmark }: { benchmark?: readonly BacktestBar[] } = {},
): BacktestOutcome {
    if (definition.rules.length === 0) return { ok: false, code: 'NO_RULES', message: 'Add a rule to backtest.' };
    if (definition.symbols.length === 0) return { ok: false, code: 'NO_SYMBOLS', message: 'Add a ticker for the strategy to trade.' };
    const compiled = compileRules(definition);
    if (!compiled.ok) return { ok: false, code: 'INVALID_RULE', message: compiled.message };
    const { rules } = compiled;
    const holdRules = rules.map((r) => (r.op === 'crosses above' ? { ...r, op: '>' as const } : r.op === 'crosses below' ? { ...r, op: '<' as const } : r));

    const symbolsWithoutHistory = definition.symbols.filter((s) => !(barsBySymbol[s]?.length));
    const data = new Map<string, SymbolData>();
    for (const symbol of definition.symbols) {
        const bars = [...(barsBySymbol[symbol] ?? [])].sort((a, b) => a.date.localeCompare(b.date));
        if (bars.length) data.set(symbol, prepare(bars, rules));
    }
    if (data.size === 0) {
        return { ok: false, code: 'NO_HISTORY', message: 'Atlas has no price history for these tickers yet. It arrives over the next few nights.' };
    }

    const calendar = [...new Set([...data.values()].flatMap((d) => d.bars.map((b) => b.date)))].sort();
    const warmup = warmupSessions(rules);
    if (calendar.length < warmup + 2) {
        return {
            ok: false,
            code: 'SHORT_HISTORY',
            message: `These rules need ${warmup + 2} sessions of history; Atlas has ${calendar.length}.`,
        };
    }

    const { maxPositionPct, stopLossPct, rebalanceDays } = definition.guardrails;
    let cash = INITIAL_CAPITAL;
    const held = new Map<string, Position>();
    const lastClose = new Map<string, number>();
    const trades: BacktestTrade[] = [];
    const equity: number[] = [];
    let pendingSells = new Set<string>();
    let pendingBuys: { symbol: string; budget: number }[] = [];
    let lastCheck: string | null = null;

    const close = (symbol: string, position: Position, date: string, price: number, exitReason: BacktestTrade['exitReason']) => {
        cash += position.quantity * price;
        held.delete(symbol);
        trades.push({
            symbol,
            entryDate: position.entryDate,
            entryPrice: position.entryPrice,
            exitDate: date,
            exitPrice: price,
            quantity: position.quantity,
            pnl: (price - position.entryPrice) * position.quantity,
            exitReason,
        });
    };

    const window = calendar.slice(warmup);
    for (const date of window) {
        const barOf = (symbol: string) => {
            const d = data.get(symbol);
            const i = d?.index.get(date);
            return i === undefined ? undefined : d!.bars[i];
        };

        // 1. Yesterday's signals, at today's open (sells first, to free cash).
        const sellsLeft = new Set<string>();
        for (const symbol of pendingSells) {
            const bar = barOf(symbol);
            const position = held.get(symbol);
            if (!position) continue;
            if (bar) close(symbol, position, date, bar.open, 'rules');
            else sellsLeft.add(symbol);
        }
        pendingSells = sellsLeft;
        const buysLeft: typeof pendingBuys = [];
        const boughtToday = new Set<string>();
        for (const order of pendingBuys) {
            const bar = barOf(order.symbol);
            if (!bar) {
                buysLeft.push(order);
                continue;
            }
            const spend = Math.min(order.budget, cash);
            if (held.has(order.symbol) || spend < 1 || bar.open <= 0) continue;
            cash -= spend;
            held.set(order.symbol, { quantity: spend / bar.open, entryPrice: bar.open, entryDate: date });
            boughtToday.add(order.symbol);
        }
        pendingBuys = buysLeft;

        // 2. Stops, through the session.
        for (const [symbol, position] of [...held]) {
            const bar = barOf(symbol);
            const stop = position.entryPrice * (1 - stopLossPct);
            if (!bar || bar.low > stop) continue;
            const price = !boughtToday.has(symbol) && bar.open < stop ? bar.open : stop;
            close(symbol, position, date, price, 'stop');
            pendingSells.delete(symbol);
        }

        // 3. Equity at the close.
        for (const symbol of data.keys()) {
            const bar = barOf(symbol);
            if (bar) lastClose.set(symbol, bar.close);
        }
        let value = cash;
        for (const [symbol, position] of held) value += position.quantity * (lastClose.get(symbol) ?? position.entryPrice);
        equity.push(value);

        // 4. A check day: read the rules at the close.
        const due = lastCheck === null || (Date.parse(date) - Date.parse(lastCheck)) / DAY_MS >= rebalanceDays;
        if (!due) continue;
        lastCheck = date;
        for (const symbol of definition.symbols) {
            const d = data.get(symbol);
            const i = d?.index.get(date);
            if (!d || i === undefined) continue;
            const pass = rulesHold(d, i, held.has(symbol) ? holdRules : rules, definition.conjunctions);
            if (held.has(symbol) && !pass) pendingSells.add(symbol);
            else if (!held.has(symbol) && pass && !pendingBuys.some((o) => o.symbol === symbol)) {
                pendingBuys.push({ symbol, budget: value * maxPositionPct });
            } else if (pass) pendingSells.delete(symbol);
        }
    }

    const from = window[0];
    const to = window[window.length - 1];
    const returns = equity.slice(1).map((e, i) => e / equity[i] - 1);
    const stats = summarize(equity, returns, trades, from, to);
    const monteCarlo = returns.length >= MIN_RETURNS ? resample(returns, seedOf(definition, from, to)) : null;
    const { verdict, verdictReason } = judge(stats, monteCarlo, window.length);

    return {
        ok: true,
        trades,
        backtest: {
            from,
            to,
            verdict,
            verdictReason,
            equityCurve: equity.map((e) => round((e / INITIAL_CAPITAL) * 100, 4)),
            stats,
            benchmark: benchmarkReturn(benchmark, from, to),
            monteCarlo,
            symbolsWithoutHistory,
            definition,
        },
    };
}

function summarize(equity: readonly number[], returns: readonly number[], trades: readonly BacktestTrade[], from: string, to: string): BacktestStats {
    const final = equity[equity.length - 1];
    const days = (Date.parse(to) - Date.parse(from)) / DAY_MS;
    const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const sd = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1));
    const downside = Math.sqrt(returns.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / (returns.length || 1));
    const enough = returns.length >= MIN_RETURNS;
    let peak = equity[0];
    let maxDrawdown = 0;
    for (const e of equity) {
        peak = Math.max(peak, e);
        maxDrawdown = Math.min(maxDrawdown, e / peak - 1);
    }
    const wins = trades.filter((t) => t.pnl > 0);
    const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
    const grossLoss = -trades.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
    return {
        totalReturnPct: round((final / INITIAL_CAPITAL - 1) * 100, 2),
        cagrPct: days >= 365 ? round(((final / INITIAL_CAPITAL) ** (365.25 / days) - 1) * 100, 2) : null,
        netProfitUsd: round(final - INITIAL_CAPITAL, 2),
        sharpe: enough && sd > 0 ? round((mean / sd) * Math.sqrt(252), 2) : null,
        sortino: enough && downside > 0 ? round((mean / downside) * Math.sqrt(252), 2) : null,
        maxDrawdownPct: round(maxDrawdown * 100, 2),
        profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : null,
        tradeCount: trades.length,
        winRatePct: trades.length ? round((wins.length / trades.length) * 100, 1) : null,
    };
}

/**
 * SPY from its last close on or before the first session to its last on or
 * before the last, each within a week of it; otherwise none, rather than a
 * return over some other window.
 */
function benchmarkReturn(bars: readonly BacktestBar[] | undefined, from: string, to: string): StrategyBacktest['benchmark'] {
    const sorted = [...(bars ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const start = sorted.filter((b) => b.date <= from).at(-1);
    const end = sorted.filter((b) => b.date <= to).at(-1);
    const near = (date: string, target: string) => Date.parse(target) - Date.parse(date) <= 7 * DAY_MS;
    if (!start || !end || start.close <= 0 || !near(start.date, from) || !near(end.date, to)) return null;
    return { symbol: BENCHMARK_SYMBOL, totalReturnPct: round((end.close / start.close - 1) * 100, 2) };
}

/** mulberry32: small, fast and the same everywhere. */
function random(seed: number): () => number {
    let a = seed | 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), a | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seedOf(definition: StrategyDefinition, from: string, to: string): number {
    const text = JSON.stringify([definition.rules.map(({ field, op, value }) => [field, op, value]), definition.conjunctions, definition.symbols, definition.guardrails, from, to]);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h;
}

function resample(returns: readonly number[], seed: number): MonteCarloCell[] {
    const next = random(seed);
    const ends: number[] = [];
    for (let p = 0; p < MONTE_CARLO_PATHS; p++) {
        let multiple = 1;
        for (let i = 0; i < returns.length; i++) multiple *= 1 + returns[Math.floor(next() * returns.length)];
        ends.push(multiple);
    }
    ends.sort((a, b) => a - b);
    return PERCENTILES.map((percentile) => ({
        percentile,
        value: round(ends[Math.min(ends.length - 1, Math.floor((percentile / 100) * ends.length))], 3),
    }));
}

/** A verdict with its reason; the thresholds are the reason's words. */
export function judge(stats: BacktestStats, monteCarlo: readonly MonteCarloCell[] | null, sessions: number): { verdict: BacktestVerdict; verdictReason: string } {
    if (sessions < MIN_SESSIONS_TO_JUDGE) {
        return { verdict: 'Unproven', verdictReason: 'Under six months of history: too short to judge.' };
    }
    if (stats.tradeCount < MIN_TRADES_TO_JUDGE) {
        return { verdict: 'Unproven', verdictReason: `${stats.tradeCount} closed trade${stats.tradeCount === 1 ? '' : 's'}: too few to judge.` };
    }
    const p = (n: number) => monteCarlo?.find((c) => c.percentile === n)?.value ?? null;
    if (stats.sharpe === null || p(25) === null) {
        return { verdict: 'Unproven', verdictReason: 'Too few daily returns to judge.' };
    }
    if (stats.sharpe < 0.5 || p(25)! < 1) {
        return {
            verdict: 'Fragile',
            verdictReason: stats.sharpe < 0.5
                ? `Sharpe ${stats.sharpe.toFixed(2)}, under 0.5: the return barely covered its swings.`
                : 'More than a quarter of the resampled paths ended below the start.',
        };
    }
    if (stats.sharpe >= 1 && p(5)! >= 1) {
        return { verdict: 'Robust', verdictReason: `Sharpe ${stats.sharpe.toFixed(2)}, and 95% of the resampled paths ended above the start.` };
    }
    return {
        verdict: 'Promising',
        verdictReason: stats.sharpe < 1
            ? `Sharpe ${stats.sharpe.toFixed(2)}, between 0.5 and 1.`
            : 'Sharpe of at least 1, but more than 5% of the resampled paths ended below the start.',
    };
}

function round(n: number, digits: number): number {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}
