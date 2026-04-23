/**
 * Strategy data model used by the Phase 6 (AR-80/81/82) Strategy Builder.
 *
 * Kept pure (no DOM, no localStorage) so the reducer logic is easy to
 * unit-test and reusable when the builder is eventually persisted to the
 * backend. The types intentionally mirror the handoff JSON shape: rules
 * are flat records so the builder can flatten them into a conjunction list
 * the user renders as AND/OR pills.
 */

export type StrategyStatus = 'active' | 'paused' | 'backtesting';
export type StrategyConjunction = 'AND' | 'OR';
export type StrategyOp =
    | '>'
    | '>='
    | '<'
    | '<='
    | '='
    | '!='
    | 'crosses above'
    | 'crosses below';

export interface StrategyRule {
    id: string;
    field: string; // e.g. "RSI(14)", "P/E", "MomScore"
    op: StrategyOp;
    value: string; // stringified so "30" and "SMA(50)" both fit
}

export interface StrategyUniverseFilter {
    id: string;
    label: string;
    /** Filters are on/off toggles in the UI — disabled ones render dimmed. */
    enabled: boolean;
}

export interface StrategyGuardrails {
    /** Max fraction of equity per position (0..1, e.g. 0.05 = 5%). */
    maxPositionPct: number;
    /** Hard stop on a single position (0..1, e.g. 0.12 = 12%). */
    stopLossPct: number;
    /** Rebalance cadence in days (7=weekly, 30=monthly, 90=quarterly). */
    rebalanceDays: number;
}

export type MonteCarloPercentile = 5 | 25 | 50 | 75 | 95;

export interface MonteCarloCell {
    percentile: MonteCarloPercentile;
    /** Terminal equity multiplier (1.0 = flat). */
    value: number;
    /** Implied annualized return for that percentile. */
    cagrPct: number;
}

export interface BacktestStats {
    /** Compound annual growth rate (%). */
    cagrPct: number;
    /** Net profit in USD from $100k starting equity. */
    netProfitUsd: number;
    sharpe: number;
    sortino: number;
    /** Worst peak-to-trough, reported as negative %. */
    maxDrawdownPct: number;
    profitFactor: number;
    tradeCount: number;
    winRatePct: number;
}

export type PromotionStepKey =
    | 'rules'
    | 'backtest'
    | 'robustness'
    | 'paper'
    | 'live';

export type PromotionStatus = 'done' | 'active' | 'pending';

export interface PromotionStep {
    key: PromotionStepKey;
    label: string;
    status: PromotionStatus;
}

export interface StrategyBacktest {
    /** Pretty label for the head, e.g. "Jan 2020 – Apr 2026". */
    windowLabel: string;
    /** Overall robustness verdict rendered next to the head. */
    verdict: 'Robust' | 'Fragile' | 'Promising' | 'Unproven';
    /** Equity curve series (normalized so start = 100). */
    equityCurve: number[];
    stats: BacktestStats;
    /** 5 cells, 95/75/50/25/5th percentiles. Callers enforce order. */
    monteCarlo: MonteCarloCell[];
    /** Ordered promotion ladder. */
    promotion: PromotionStep[];
}

export interface Strategy {
    id: string;
    shortId: string; // "S-001" — shown on the card
    name: string;
    description: string;
    status: StrategyStatus;
    stats: {
        /** Total return % since inception. */
        totalReturnPct: number;
        sharpe: number;
        maxDrawdownPct: number;
        winRatePct: number;
    };
    rules: StrategyRule[];
    conjunctions: StrategyConjunction[]; // length = rules.length - 1
    universe: StrategyUniverseFilter[];
    guardrails: StrategyGuardrails;
    backtest: StrategyBacktest;
}

// ---------------------------------------------------------------------------
// Reducer helpers — used by the Phase 6 client to edit rules/guardrails.
// All return new arrays/objects so the client can rely on shallow equality
// for memoization and we never mutate the seed data.
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

export function toggleUniverseFilter(
    universe: readonly StrategyUniverseFilter[],
    id: string,
): StrategyUniverseFilter[] {
    return universe.map((u) => (u.id === id ? { ...u, enabled: !u.enabled } : u));
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
