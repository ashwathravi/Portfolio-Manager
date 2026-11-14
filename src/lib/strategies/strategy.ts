/**
 * Strategy data model for the Strategy Builder (AR-80/81/82), saved to the
 * user's account since launch item i55.
 *
 * A strategy's definition is what a backtest runs: entry rules glued by
 * AND/OR, the tickers it may hold, and guardrails for sizing, stops and how
 * often the rules are checked. The helpers here are pure, so the builder,
 * the API and the backtest engine share them.
 */

import type { AdherenceRule } from '@/lib/adherence/rules';

export type StrategyConjunction = 'AND' | 'OR';
export type StrategyOp = '>' | '>=' | '<' | '<=' | 'crosses above' | 'crosses below';

export const STRATEGY_OPS: readonly StrategyOp[] = ['>', '>=', '<', '<=', 'crosses above', 'crosses below'];

const OP_LABELS: Partial<Record<StrategyOp, string>> = { '>=': '≥', '<=': '≤' };

/** How an operator reads on screen — typographic symbols, not ASCII `>=`. */
export function opLabel(op: StrategyOp): string {
    return OP_LABELS[op] ?? op;
}

export interface StrategyRule {
    id: string;
    /** An indicator (indicators.ts): "RSI(14)", "Mom(6M)", "Close". */
    field: string;
    op: StrategyOp;
    /** A number ("30", "10%", "$5M") or another indicator ("SMA(50)"). */
    value: string;
}

export interface StrategyGuardrails {
    /** Max fraction of equity per position (0..1, e.g. 0.05 = 5%). */
    maxPositionPct: number;
    /** Hard stop on a single position (0..1, e.g. 0.12 = 12%). */
    stopLossPct: number;
    /** How often the rules are checked, in calendar days (7 = weekly). */
    rebalanceDays: number;
}

export interface StrategyDefinition {
    rules: StrategyRule[];
    conjunctions: StrategyConjunction[]; // length = rules.length - 1
    /** The tickers the strategy may hold. */
    symbols: string[];
    guardrails: StrategyGuardrails;
}

export type BacktestVerdict = 'Robust' | 'Fragile' | 'Promising' | 'Unproven';

export interface BacktestStats {
    totalReturnPct: number;
    /** Compound annual growth rate (%); null under a year, where it would overstate. */
    cagrPct: number | null;
    /** Net profit in USD from $100k starting equity. */
    netProfitUsd: number;
    /** Annualized from daily returns; null with too few of them. */
    sharpe: number | null;
    sortino: number | null;
    /** Worst peak-to-trough, reported as negative %. */
    maxDrawdownPct: number;
    /** Gross profit over gross loss of closed trades; null without a losing trade. */
    profitFactor: number | null;
    /** Closed trades. */
    tradeCount: number;
    winRatePct: number | null;
}

export interface MonteCarloCell {
    percentile: 5 | 25 | 50 | 75 | 95;
    /** Ending equity as a multiple of the start (1.0 = flat). */
    value: number;
}

export type PromotionStepKey = 'rules' | 'backtest' | 'robustness' | 'paper' | 'live';
export type PromotionStatus = 'done' | 'active' | 'pending';

export interface PromotionStep {
    key: PromotionStepKey;
    label: string;
    status: PromotionStatus;
}

export interface StrategyBacktest {
    /** First and last session of the window, YYYY-MM-DD. */
    from: string;
    to: string;
    verdict: BacktestVerdict;
    /** Why, in a sentence: the verdict is never an opaque score. */
    verdictReason: string;
    /** Equity at each session's close, normalized so the start = 100. */
    equityCurve: number[];
    stats: BacktestStats;
    /** Buy-and-hold SPY over the same window, when Atlas has its closes. */
    benchmark: { symbol: string; totalReturnPct: number } | null;
    /** 5th to 95th percentile, lowest first; null with too few daily returns. */
    monteCarlo: MonteCarloCell[] | null;
    /** Tickers in the strategy without stored history; left out of the run. */
    symbolsWithoutHistory: string[];
    /** The definition the backtest ran on. */
    definition: StrategyDefinition;
    /** When it ran (ISO); absent on the examples. */
    ranAt?: string;
    /** The examples' promotion ladder; Atlas has no paper trading to promote a saved strategy to. */
    promotion?: PromotionStep[];
}

export interface Strategy extends StrategyDefinition {
    id: string;
    name: string;
    description: string;
    /** An example (labelled Sample), not one saved to the user's account. */
    example?: boolean;
    /** AR-111 discipline rules checked when the user trades. */
    adherenceRules: AdherenceRule[];
    /** The last backtest; null before the first. */
    backtest: StrategyBacktest | null;
}

export const STRATEGY_LIMITS = {
    perUser: 20,
    name: 80,
    description: 280,
    rules: 10,
    ruleText: 24,
    symbols: 25,
    adherenceRules: 20,
} as const;

export const DEFAULT_GUARDRAILS: StrategyGuardrails = { maxPositionPct: 0.25, stopLossPct: 0.1, rebalanceDays: 7 };

// ---------------------------------------------------------------------------
// Reducer helpers — used by the builder to edit rules, symbols and
// guardrails. All return new arrays/objects so the client can rely on
// shallow equality for memoization.
// ---------------------------------------------------------------------------

export function addRule(
    rules: readonly StrategyRule[],
    conjunctions: readonly StrategyConjunction[],
    rule: StrategyRule,
    glue: StrategyConjunction = 'AND',
): { rules: StrategyRule[]; conjunctions: StrategyConjunction[] } {
    const nextRules = [...rules, rule];
    const nextConj = rules.length === 0 ? [] : [...conjunctions, glue];
    return { rules: nextRules, conjunctions: nextConj };
}

export function removeRule(
    rules: readonly StrategyRule[],
    conjunctions: readonly StrategyConjunction[],
    id: string,
): { rules: StrategyRule[]; conjunctions: StrategyConjunction[] } {
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) return { rules: [...rules], conjunctions: [...conjunctions] };
    const nextRules = rules.filter((r) => r.id !== id);
    // Drop the conjunction that was glued to the removed rule. We remove
    // the one BEFORE it when possible (the left-side glue), which keeps the
    // visual flow intuitive.
    const conjIdx = idx === 0 ? 0 : idx - 1;
    const nextConj = conjunctions.filter((_, i) => i !== conjIdx);
    return { rules: nextRules, conjunctions: nextConj };
}

export function setConjunction(
    conjunctions: readonly StrategyConjunction[],
    index: number,
    next: StrategyConjunction,
): StrategyConjunction[] {
    return conjunctions.map((c, i) => (i === index ? next : c));
}

/** Adds tickers not there yet, uppercased, in order, up to the limit. */
export function addSymbols(symbols: readonly string[], added: readonly string[]): string[] {
    const out = [...symbols];
    for (const symbol of added.map((s) => s.trim().toUpperCase())) {
        if (symbol && !out.includes(symbol) && out.length < STRATEGY_LIMITS.symbols) out.push(symbol);
    }
    return out;
}

export function removeSymbol(symbols: readonly string[], symbol: string): string[] {
    return symbols.filter((s) => s !== symbol);
}

export function setGuardrail<K extends keyof StrategyGuardrails>(
    g: StrategyGuardrails,
    key: K,
    value: StrategyGuardrails[K],
): StrategyGuardrails {
    return { ...g, [key]: value };
}

/**
 * Best human-readable summary of the rule set — shown on strategy cards
 * where a full rule list would be noisy. Returns "N rules" for N >= 1 and
 * "No rules" when the strategy hasn't been configured yet.
 */
export function summarizeRules(strategy: Pick<Strategy, 'rules'>): string {
    const n = strategy.rules.length;
    if (n === 0) return 'No rules';
    return `${n} rule${n === 1 ? '' : 's'}`;
}

export function strategyDefinition(s: StrategyDefinition): StrategyDefinition {
    return { rules: s.rules, conjunctions: s.conjunctions, symbols: s.symbols, guardrails: s.guardrails };
}

/**
 * A copy for the user to experiment with: a new name ("(copy)", then
 * "(copy 2)"), new rule ids and no backtest of its own. The caller gives it
 * an id (the server does, for a saved one).
 */
export function duplicateStrategy(source: Strategy, existing: readonly Pick<Strategy, 'name'>[], id: string): Strategy {
    const names = new Set(existing.map((s) => s.name));
    let name = `${source.name} (copy)`;
    let k = 2;
    while (names.has(name)) name = `${source.name} (copy ${k++})`;
    return {
        id,
        name: name.slice(0, STRATEGY_LIMITS.name),
        description: source.description,
        rules: source.rules.map((r, i) => ({ ...r, id: `r${i + 1}` })),
        conjunctions: [...source.conjunctions],
        symbols: [...source.symbols],
        guardrails: { ...source.guardrails },
        adherenceRules: source.adherenceRules.map((r) => ({ ...r, params: { ...r.params } })),
        backtest: null,
    };
}

/**
 * True when the rules, symbols, or guardrails differ from the version the
 * backtest ran on — the backtest panel then flags its results as out of
 * date instead of silently showing numbers for different rules.
 */
export function hasUnbacktestedChanges(current: StrategyDefinition, backtested: StrategyDefinition): boolean {
    const strip = (s: StrategyDefinition) => ({
        rules: s.rules.map(({ field, op, value }) => ({ field, op, value })),
        conjunctions: s.conjunctions,
        symbols: s.symbols,
        guardrails: s.guardrails,
    });
    return JSON.stringify(strip(current)) !== JSON.stringify(strip(backtested));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jan 2020 – Apr 2026" for a window's first and last session. */
export function backtestWindowLabel(from: string, to: string): string {
    const label = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
    return `${label(from)} – ${label(to)}`;
}
