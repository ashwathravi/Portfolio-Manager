/**
 * Strategy rule adherence — data model (AR-111 JournalPlus Integration).
 *
 * This is the "discipline" rule layer. It sits alongside the existing
 * entry-signal `StrategyRule` (`RSI(14) > 30` etc.) in `strategies/strategy.ts`
 * but models a different concept — constraints the trader agrees to
 * follow *at execution time* rather than filters for picking stocks.
 *
 * Keeping the two concepts in separate files with distinct type names
 * (`AdherenceRule` vs. `StrategyRule`) means the Strategies builder can
 * compose both without the vocabulary collapsing, and downstream
 * consumers grep clean for either set.
 *
 * The palette is fixed (seven types) so evaluators can be exhaustive —
 * adding a rule means a new compile error in `evaluate.ts` rather than
 * a silent "unknown rule" fall-through. That tradeoff is deliberate:
 * the feature is only valuable if every rule produces a result.
 */

/**
 * All rule kinds. Exhaustive — every `AdherenceRuleType` has a matching
 * evaluator in `evaluate.ts`. Extending this union is the ONLY way to
 * add a new rule; the evaluator `Record<…>` guarantees coverage.
 */
export type AdherenceRuleType =
    | 'max_position_pct'
    | 'max_sector_pct'
    | 'no_trade_near_earnings'
    | 'stop_loss_required'
    | 'thesis_required'
    | 'min_conviction'
    | 'allowed_hours';

/**
 * Severity tells the UI whether a failure is a "warning" (soft) or a
 * "block" (hard). v1 per AR-111 non-goals: we never actually block a
 * trade — but we carry the bit so the UI can style severe violations
 * redder and so v2 can promote some rules to hard-blocks behind a flag.
 */
export type AdherenceSeverity = 'hard' | 'soft';

/**
 * Params differ per rule. Typed strictly so the editor can render the
 * right input without a switch-and-string-parse dance.
 */
export interface AdherenceRuleParams {
    /** Percent threshold for `max_position_pct` / `max_sector_pct`, 0-100. */
    pct?: number;
    /** Sector name for `max_sector_pct`. Free-text in v1 since the
     *  strategy seed ships common GICS sectors ("Technology", "Health
     *  Care", etc.). */
    sector?: string;
    /** Days threshold for `no_trade_near_earnings` (e.g. 3 = no trade
     *  within 3 days of an earnings release). */
    days?: number;
    /** Threshold for `min_conviction` (1-10 scale, matching the
     *  rationale picker from AR-109). */
    value?: number;
    /** Hour-of-day window (0-23, inclusive start, exclusive end) for
     *  `allowed_hours`. `fromHour=9`/`toHour=16` = US cash session. */
    fromHour?: number;
    toHour?: number;
}

/**
 * A single rule as stored on a `Strategy`. `id` is client-generated and
 * stable across edits. `severity` defaults to `soft` for v1 but is
 * carried so per-rule hard-blocks can ship behind a flag without a
 * migration.
 */
export interface AdherenceRule {
    id: string;
    type: AdherenceRuleType;
    params: AdherenceRuleParams;
    severity: AdherenceSeverity;
}

/**
 * Evaluator output for a single rule. Both `observed` and `threshold`
 * are pre-formatted display strings so the UI can render the row
 * without reimporting the formatting helpers. `passed` is authoritative.
 */
export interface RuleEvalResult {
    ruleId: string;
    ruleType: AdherenceRuleType;
    passed: boolean;
    /** Display-ready observed value, e.g. "2.8%", "thesis #4", "—". */
    observed: string;
    /** Display-ready threshold, e.g. "≤ 5%", "required", "9-16". */
    threshold: string;
    /** One-line plain-English description of what this rule is checking.
     *  Lifted from `ADHERENCE_RULE_META[type].shortDesc` so both the
     *  live execution panel and the frozen trade detail can render
     *  without re-lookup. */
    label: string;
    severity: AdherenceSeverity;
}

/**
 * Per-trade adherence bundle. Stored on a closed `JournalEntry` once
 * computed; also emitted live on every render of the execution panel.
 * The `evaluatedAt` ISO timestamp is the freeze time — for the
 * execution panel it's the current render, for a journal entry it's
 * the submit moment.
 */
export interface TradeAdherence {
    /** 0-100, rounded to integer. Zero rules = 100 (nothing to violate). */
    score: number;
    results: RuleEvalResult[];
    evaluatedAt: string;
}

// --------------------------------------------------------------------- //
// Palette metadata
// --------------------------------------------------------------------- //

/**
 * Display metadata for each rule type. Used by the Strategies editor
 * to render the add-rule dropdown, by the execution panel to title
 * each row, and by the frozen trade detail to label historical results.
 *
 * Kept in the same file as the type union so a new `AdherenceRuleType`
 * variant is a single TypeScript compile error in two places instead
 * of silent missing metadata.
 */
export interface AdherenceRuleMeta {
    type: AdherenceRuleType;
    /** Card title in the palette picker, e.g. "Max position size". */
    title: string;
    /** One-sentence explanation. Used as the palette subtitle AND as
     *  the default eval-result label. */
    shortDesc: string;
    /** Parameter descriptors for the editor. Empty array = no params. */
    paramSpec: AdherenceParamSpec[];
    /** Default params when the user adds a rule of this type. Matches
     *  each `paramSpec` key so "add rule" never renders a bad form. */
    defaultParams: AdherenceRuleParams;
    /** Default severity when added. v1: everything is soft. */
    defaultSeverity: AdherenceSeverity;
}

export interface AdherenceParamSpec {
    key: keyof AdherenceRuleParams;
    /** Display label in the editor, e.g. "Threshold (%)". */
    label: string;
    /** Input kind. */
    kind: 'percent' | 'number' | 'sector' | 'hour';
    /** Inclusive input bounds. Enforced by the editor, not the evaluator. */
    min?: number;
    max?: number;
    /** Step increment for numeric inputs. */
    step?: number;
    /** Suffix shown after the input, e.g. "%", "days". */
    suffix?: string;
}

export const ADHERENCE_RULE_META: Readonly<Record<AdherenceRuleType, AdherenceRuleMeta>> = {
    max_position_pct: {
        type: 'max_position_pct',
        title: 'Max position size',
        shortDesc: 'No single position > X% of NAV',
        paramSpec: [
            {
                key: 'pct',
                label: 'Threshold',
                kind: 'percent',
                min: 0.1,
                max: 100,
                step: 0.1,
                suffix: '%',
            },
        ],
        defaultParams: { pct: 5 },
        defaultSeverity: 'soft',
    },
    max_sector_pct: {
        type: 'max_sector_pct',
        title: 'Max sector exposure',
        shortDesc: 'Sector weight stays under X% after the fill',
        paramSpec: [
            {
                key: 'sector',
                label: 'Sector',
                kind: 'sector',
            },
            {
                key: 'pct',
                label: 'Threshold',
                kind: 'percent',
                min: 1,
                max: 100,
                step: 1,
                suffix: '%',
            },
        ],
        defaultParams: { sector: 'Technology', pct: 30 },
        defaultSeverity: 'soft',
    },
    no_trade_near_earnings: {
        type: 'no_trade_near_earnings',
        title: 'No trade near earnings',
        shortDesc: 'At least N days from the next earnings release',
        paramSpec: [
            {
                key: 'days',
                label: 'Quiet window',
                kind: 'number',
                min: 1,
                max: 30,
                step: 1,
                suffix: 'days',
            },
        ],
        defaultParams: { days: 3 },
        defaultSeverity: 'soft',
    },
    stop_loss_required: {
        type: 'stop_loss_required',
        title: 'Stop loss required',
        shortDesc: 'Every order carries a stop',
        paramSpec: [],
        defaultParams: {},
        defaultSeverity: 'soft',
    },
    thesis_required: {
        type: 'thesis_required',
        title: 'Thesis required',
        shortDesc: 'Rationale links to a written thesis',
        paramSpec: [],
        defaultParams: {},
        defaultSeverity: 'soft',
    },
    min_conviction: {
        type: 'min_conviction',
        title: 'Min conviction',
        shortDesc: 'Rationale conviction ≥ N on the 1-10 scale',
        paramSpec: [
            {
                key: 'value',
                label: 'Minimum',
                kind: 'number',
                min: 1,
                max: 10,
                step: 1,
                suffix: '/ 10',
            },
        ],
        defaultParams: { value: 6 },
        defaultSeverity: 'soft',
    },
    allowed_hours: {
        type: 'allowed_hours',
        title: 'Allowed hours',
        shortDesc: 'Order placed within the chosen window',
        paramSpec: [
            {
                key: 'fromHour',
                label: 'From',
                kind: 'hour',
                min: 0,
                max: 23,
                step: 1,
                suffix: ':00',
            },
            {
                key: 'toHour',
                label: 'To',
                kind: 'hour',
                min: 0,
                max: 24,
                step: 1,
                suffix: ':00',
            },
        ],
        defaultParams: { fromHour: 9, toHour: 16 },
        defaultSeverity: 'soft',
    },
} as const;

/**
 * Ordered list for the editor's add-rule picker. Stable so the
 * dropdown lands in the same order every render.
 */
export const ADHERENCE_RULE_ORDER: ReadonlyArray<AdherenceRuleType> = [
    'max_position_pct',
    'max_sector_pct',
    'stop_loss_required',
    'thesis_required',
    'min_conviction',
    'no_trade_near_earnings',
    'allowed_hours',
];

// --------------------------------------------------------------------- //
// Reducer helpers
// --------------------------------------------------------------------- //

/** Generate a stable id for a new rule. Monotonic + random suffix so
 *  same-tick double-adds don't collide. */
export function newAdherenceRuleId(): string {
    return `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Build a default rule of the given type — used by the "add rule"
 *  dropdown. */
export function buildDefaultRule(type: AdherenceRuleType): AdherenceRule {
    const meta = ADHERENCE_RULE_META[type];
    return {
        id: newAdherenceRuleId(),
        type,
        params: { ...meta.defaultParams },
        severity: meta.defaultSeverity,
    };
}
