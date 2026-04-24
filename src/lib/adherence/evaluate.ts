/**
 * Adherence rule evaluator (AR-111 JournalPlus Integration).
 *
 * Pure, synchronous, exhaustive. Given a list of `AdherenceRule`s and a
 * `TradeContext`, return a `TradeAdherence` bundle with one
 * `RuleEvalResult` per rule and a 0-100 score.
 *
 * The core shape is a `Record<AdherenceRuleType, (rule, ctx) => RuleEvalResult>`
 * so adding a new rule type is:
 *   1. add a variant to `AdherenceRuleType` in `rules.ts` (compile error),
 *   2. add metadata to `ADHERENCE_RULE_META`  (compile error),
 *   3. add an evaluator here (compile error).
 *
 * No runtime branching, no "unknown rule" fallthrough. If the build
 * passes, every rule has a working predicate.
 */

import {
    ADHERENCE_RULE_META,
    type AdherenceRule,
    type AdherenceRuleType,
    type RuleEvalResult,
    type TradeAdherence,
} from './rules';
import type { TradeRationale } from '@/types/trade';

/**
 * All the pieces the evaluators need to run. Deliberately flat — not a
 * reference to the full `JournalEntry` — so the live execution panel
 * can hand-assemble a context from the ticket draft without the rest
 * of the journal shape.
 *
 * `undefined` means "not known", which evaluators treat distinct from
 * "zero". For example, `stopLoss === undefined` fails `stop_loss_required`
 * (the rule is explicitly asking: "did you set one?") whereas
 * `nav === undefined` means the evaluator can't score `max_position_pct`
 * meaningfully and returns a neutral pass — we don't want the live
 * panel crying wolf just because a portfolio balance hasn't loaded yet.
 */
export interface TradeContext {
    ticker: string;
    side: 'buy' | 'sell';
    /** Portfolio net asset value in USD. Drives the %-of-NAV math. */
    nav?: number;
    /** Market value of the position *after* this trade fills. */
    postMarketValue?: number;
    /** GICS-style sector string for the ticker. Nullable — the evaluator
     *  skips `max_sector_pct` when unknown. */
    sector?: string;
    /** Post-fill sector exposure as a fraction (0.18 = 18%). */
    sectorExposurePct?: number;
    /** Days until the ticker's next scheduled earnings release. `null`
     *  means "unknown, can't evaluate"; `0` is legal and fails
     *  `no_trade_near_earnings` hard. */
    daysUntilEarnings?: number | null;
    /** Stop-loss price attached to the ticket. `null`/`undefined` =
     *  no stop, which is exactly what `stop_loss_required` is checking
     *  for. */
    stopLoss?: number | null;
    /** Rationale at time of submit. May be `null` when the user disabled
     *  the rationale requirement in Settings — `thesis_required` and
     *  `min_conviction` fail in that case. */
    rationale?: TradeRationale | null;
    /** Execution timestamp. ISO string or ms epoch. */
    executedAt?: string | number;
}

// --------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------- //

function fmtPct(n: number): string {
    if (!Number.isFinite(n)) return '—';
    // Two decimals under 10, one decimal otherwise — mirrors how
    // brokerage UIs show small vs. large allocations.
    if (Math.abs(n) < 10) return `${n.toFixed(2)}%`;
    return `${n.toFixed(1)}%`;
}

function hourOf(iso: string | number | undefined): number | null {
    if (iso == null) return null;
    const ms = typeof iso === 'number' ? iso : Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).getHours();
}

// --------------------------------------------------------------------- //
// Per-rule evaluators
// --------------------------------------------------------------------- //

type Evaluator = (rule: AdherenceRule, ctx: TradeContext) => RuleEvalResult;

const evaluators: Record<AdherenceRuleType, Evaluator> = {
    max_position_pct: (rule, ctx) => {
        const { nav, postMarketValue } = ctx;
        const threshold = rule.params.pct ?? 0;
        const label = ADHERENCE_RULE_META.max_position_pct.shortDesc;
        // If we don't have NAV yet (loading state), pass neutrally —
        // better to under-nag than to mislead the user.
        if (nav == null || postMarketValue == null || nav <= 0) {
            return {
                ruleId: rule.id,
                ruleType: rule.type,
                passed: true,
                observed: '—',
                threshold: `≤ ${fmtPct(threshold)}`,
                label,
                severity: rule.severity,
            };
        }
        const pct = (postMarketValue / nav) * 100;
        return {
            ruleId: rule.id,
            ruleType: rule.type,
            passed: pct <= threshold,
            observed: fmtPct(pct),
            threshold: `≤ ${fmtPct(threshold)}`,
            label,
            severity: rule.severity,
        };
    },

    max_sector_pct: (rule, ctx) => {
        const threshold = rule.params.pct ?? 0;
        const wantedSector = rule.params.sector ?? '';
        const label = ADHERENCE_RULE_META.max_sector_pct.shortDesc;
        // Sector unknown on the ticket — pass (same reason as nav).
        if (!ctx.sector || ctx.sectorExposurePct == null) {
            return {
                ruleId: rule.id,
                ruleType: rule.type,
                passed: true,
                observed: '—',
                threshold: `${wantedSector} ≤ ${fmtPct(threshold)}`,
                label,
                severity: rule.severity,
            };
        }
        // Only apply when the ticket's sector matches the rule's
        // sector — otherwise this rule isn't speaking to this trade.
        if (ctx.sector !== wantedSector) {
            return {
                ruleId: rule.id,
                ruleType: rule.type,
                passed: true,
                observed: `${ctx.sector} (n/a)`,
                threshold: `${wantedSector} ≤ ${fmtPct(threshold)}`,
                label,
                severity: rule.severity,
            };
        }
        const pct = ctx.sectorExposurePct * 100;
        return {
            ruleId: rule.id,
            ruleType: rule.type,
            passed: pct <= threshold,
            observed: fmtPct(pct),
            threshold: `${wantedSector} ≤ ${fmtPct(threshold)}`,
            label,
            severity: rule.severity,
        };
    },

    no_trade_near_earnings: (rule, ctx) => {
        const threshold = rule.params.days ?? 0;
        const label = ADHERENCE_RULE_META.no_trade_near_earnings.shortDesc;
        if (ctx.daysUntilEarnings == null) {
            return {
                ruleId: rule.id,
                ruleType: rule.type,
                passed: true,
                observed: '—',
                threshold: `≥ ${threshold}d`,
                label,
                severity: rule.severity,
            };
        }
        return {
            ruleId: rule.id,
            ruleType: rule.type,
            passed: ctx.daysUntilEarnings >= threshold,
            observed: `${ctx.daysUntilEarnings}d`,
            threshold: `≥ ${threshold}d`,
            label,
            severity: rule.severity,
        };
    },

    stop_loss_required: (rule, ctx) => {
        const has = ctx.stopLoss != null && Number.isFinite(ctx.stopLoss);
        return {
            ruleId: rule.id,
            ruleType: rule.type,
            passed: has,
            observed: has ? `$${(ctx.stopLoss as number).toFixed(2)}` : 'none',
            threshold: 'required',
            label: ADHERENCE_RULE_META.stop_loss_required.shortDesc,
            severity: rule.severity,
        };
    },

    thesis_required: (rule, ctx) => {
        const id = ctx.rationale?.thesisId;
        const has = typeof id === 'string' && id.length > 0;
        return {
            ruleId: rule.id,
            ruleType: rule.type,
            passed: has,
            // Truncate long ids so the row doesn't wrap.
            observed: has
                ? `${(id as string).slice(0, 18)}${(id as string).length > 18 ? '…' : ''}`
                : 'missing',
            threshold: 'required',
            label: ADHERENCE_RULE_META.thesis_required.shortDesc,
            severity: rule.severity,
        };
    },

    min_conviction: (rule, ctx) => {
        const threshold = rule.params.value ?? 0;
        const conviction = ctx.rationale?.conviction;
        if (conviction == null) {
            return {
                ruleId: rule.id,
                ruleType: rule.type,
                // No rationale at all — the rule fails, same as thesis.
                passed: false,
                observed: 'missing',
                threshold: `≥ ${threshold}`,
                label: ADHERENCE_RULE_META.min_conviction.shortDesc,
                severity: rule.severity,
            };
        }
        return {
            ruleId: rule.id,
            ruleType: rule.type,
            passed: conviction >= threshold,
            observed: `${conviction}`,
            threshold: `≥ ${threshold}`,
            label: ADHERENCE_RULE_META.min_conviction.shortDesc,
            severity: rule.severity,
        };
    },

    allowed_hours: (rule, ctx) => {
        const from = rule.params.fromHour ?? 0;
        const to = rule.params.toHour ?? 24;
        const hour = hourOf(ctx.executedAt);
        const label = ADHERENCE_RULE_META.allowed_hours.shortDesc;
        if (hour == null) {
            return {
                ruleId: rule.id,
                ruleType: rule.type,
                passed: true,
                observed: '—',
                threshold: `${from}:00 – ${to}:00`,
                label,
                severity: rule.severity,
            };
        }
        // `from <= hour < to`. The end-exclusive convention matches
        // the US session convention (9:30–16:00 means "up to but not
        // including 16:00"). We use hour-level precision in v1.
        const inWindow = hour >= from && hour < to;
        return {
            ruleId: rule.id,
            ruleType: rule.type,
            passed: inWindow,
            observed: `${hour.toString().padStart(2, '0')}:00`,
            threshold: `${from.toString().padStart(2, '0')}:00 – ${to
                .toString()
                .padStart(2, '0')}:00`,
            label,
            severity: rule.severity,
        };
    },
};

// --------------------------------------------------------------------- //
// Public entry point
// --------------------------------------------------------------------- //

/**
 * Evaluate all rules against the given context. Returns a full
 * `TradeAdherence` bundle ready to render or freeze onto a
 * `JournalEntry`.
 *
 * Score is integer 0-100, computed as `passed / total * 100`. Zero
 * rules returns 100 — a strategy with no discipline rules isn't
 * violated by anything, so the strategy header shows a clean 100/100
 * rather than a NaN.
 */
export function evaluateRules(
    rules: ReadonlyArray<AdherenceRule>,
    ctx: TradeContext,
    evaluatedAt: string = new Date().toISOString(),
): TradeAdherence {
    const results = rules.map((r) => evaluators[r.type](r, ctx));
    const passed = results.filter((r) => r.passed).length;
    const score = rules.length === 0 ? 100 : Math.round((passed / rules.length) * 100);
    return { score, results, evaluatedAt };
}

/**
 * Convenience: how many rules failed. Used by the execution panel to
 * render the "N rules violated" warning without re-walking the results.
 */
export function countViolations(a: TradeAdherence): number {
    return a.results.filter((r) => !r.passed).length;
}
