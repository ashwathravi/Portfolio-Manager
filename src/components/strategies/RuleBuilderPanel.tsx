"use client";

import { X, Plus } from "lucide-react";
import type {
    Strategy,
    StrategyConjunction,
    StrategyGuardrails,
    StrategyOp,
    StrategyRule,
    StrategyUniverseFilter,
} from "@/lib/strategies/strategy";

/**
 * Phase 6 (AR-81) Rule builder · Universe · Guardrails.
 *
 * The left side (64%) of the builder split. Lets the user compose the
 * decision logic that feeds AR-82's backtest:
 *
 *   1. RULES — flat list of (field, op, value) conditions glued by AND/OR
 *      conjunction pills. The conjunction array is length `rules.length - 1`
 *      so there's exactly one glue between each adjacent pair of rules.
 *   2. UNIVERSE — toggleable chip row. Each chip is either enabled (solid)
 *      or disabled (dimmed). Represents the rough scope of the screen.
 *   3. GUARDRAILS — three sliders with mono readouts: max position %,
 *      stop loss %, rebalance cadence (days).
 *
 * Purely controlled. The parent owns the strategies array and passes a
 * per-field update callback so we can use the reducer helpers in
 * `strategy.ts` without duplicating them here. Keeping all mutation
 * behind typed callbacks also makes it trivial to swap local state for
 * a URL-synced or backend-persisted draft later.
 */

const FIELD_OPTIONS = [
    "MomScore(6M)",
    "MomScore(3M)",
    "P/E",
    "P/B",
    "P/S",
    "EV/EBITDA",
    "RSI(14)",
    "SMA(10)",
    "SMA(50)",
    "SMA(200)",
    "ADV(30)",
    "Close",
    "SectorRS(3M)",
    "Breadth(40D)",
    "Beta(1Y)",
    "MktCap",
];

const OP_OPTIONS: StrategyOp[] = [
    ">",
    ">=",
    "<",
    "<=",
    "=",
    "!=",
    "crosses above",
    "crosses below",
];

export interface RuleBuilderPanelProps {
    strategy: Strategy;
    onChangeRule: (ruleId: string, patch: Partial<StrategyRule>) => void;
    onAddRule: () => void;
    onRemoveRule: (ruleId: string) => void;
    onChangeConjunction: (index: number, next: StrategyConjunction) => void;
    onToggleUniverse: (filterId: string) => void;
    onChangeGuardrail: <K extends keyof StrategyGuardrails>(
        key: K,
        value: StrategyGuardrails[K],
    ) => void;
}

export function RuleBuilderPanel(props: RuleBuilderPanelProps) {
    const { strategy } = props;

    return (
        <div className="pm-rule-builder pm-card">
            <RulesSection {...props} />
            <UniverseSection universe={strategy.universe} onToggle={props.onToggleUniverse} />
            <GuardrailsSection
                guardrails={strategy.guardrails}
                onChange={props.onChangeGuardrail}
            />
        </div>
    );
}

// --------------------------------------------------------------------- //
// Rules
// --------------------------------------------------------------------- //

function RulesSection(props: RuleBuilderPanelProps) {
    const { strategy } = props;
    const { rules, conjunctions } = strategy;

    return (
        <section className="pm-rb-section" aria-labelledby="rb-rules">
            <header className="pm-rb-section-head">
                <h3 id="rb-rules" className="pm-rb-section-title">Rules</h3>
                <button
                    type="button"
                    className="pm-rb-add-rule"
                    onClick={props.onAddRule}
                    aria-label="Add rule"
                >
                    <Plus className="pm-rb-add-icon" aria-hidden="true" />
                    Add rule
                </button>
            </header>

            {rules.length === 0 ? (
                <div className="pm-rb-empty">
                    No rules yet. Click <span className="pm-rb-empty-cta">Add rule</span> to
                    start composing the decision logic.
                </div>
            ) : (
                <div className="pm-rb-rules">
                    {rules.map((rule, i) => (
                        <div key={rule.id} className="pm-rb-rule-wrap">
                            <RulePill
                                rule={rule}
                                onChange={(patch) => props.onChangeRule(rule.id, patch)}
                                onRemove={() => props.onRemoveRule(rule.id)}
                            />
                            {i < conjunctions.length && (
                                <ConjunctionPill
                                    value={conjunctions[i]}
                                    onChange={(v) => props.onChangeConjunction(i, v)}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

function RulePill({
    rule,
    onChange,
    onRemove,
}: {
    rule: StrategyRule;
    onChange: (patch: Partial<StrategyRule>) => void;
    onRemove: () => void;
}) {
    return (
        <div className="pm-rb-rule">
            <select
                className="pm-rb-field"
                value={rule.field}
                onChange={(e) => onChange({ field: e.target.value })}
                aria-label="Field"
            >
                {FIELD_OPTIONS.includes(rule.field) ? null : (
                    <option value={rule.field}>{rule.field}</option>
                )}
                {FIELD_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                ))}
            </select>

            <select
                className="pm-rb-op"
                value={rule.op}
                onChange={(e) => onChange({ op: e.target.value as StrategyOp })}
                aria-label="Operator"
            >
                {OP_OPTIONS.map((op) => (
                    <option key={op} value={op}>{op}</option>
                ))}
            </select>

            <input
                type="text"
                className="pm-rb-value"
                value={rule.value}
                onChange={(e) => onChange({ value: e.target.value })}
                aria-label="Value"
                placeholder="value"
            />

            <button
                type="button"
                className="pm-rb-rule-del"
                onClick={onRemove}
                aria-label="Remove rule"
            >
                <X className="pm-rb-del-icon" aria-hidden="true" />
            </button>
        </div>
    );
}

function ConjunctionPill({
    value,
    onChange,
}: {
    value: StrategyConjunction;
    onChange: (next: StrategyConjunction) => void;
}) {
    return (
        <div className="pm-rb-conj-row" aria-hidden={false}>
            <span className="pm-rb-conj-line" aria-hidden="true" />
            <button
                type="button"
                role="switch"
                aria-checked={value === "AND"}
                aria-label={`Conjunction, currently ${value}. Click to toggle.`}
                className={`pm-rb-conj${value === "AND" ? " is-and" : " is-or"}`}
                onClick={() => onChange(value === "AND" ? "OR" : "AND")}
            >
                {value}
            </button>
            <span className="pm-rb-conj-line" aria-hidden="true" />
        </div>
    );
}

// --------------------------------------------------------------------- //
// Universe
// --------------------------------------------------------------------- //

function UniverseSection({
    universe,
    onToggle,
}: {
    universe: StrategyUniverseFilter[];
    onToggle: (id: string) => void;
}) {
    return (
        <section className="pm-rb-section" aria-labelledby="rb-universe">
            <header className="pm-rb-section-head">
                <h3 id="rb-universe" className="pm-rb-section-title">Universe</h3>
                <span className="pm-rb-section-hint">
                    {universe.filter((u) => u.enabled).length} of {universe.length} active
                </span>
            </header>
            <div className="pm-rb-universe-chips">
                {universe.map((u) => (
                    <button
                        key={u.id}
                        type="button"
                        role="switch"
                        aria-checked={u.enabled}
                        onClick={() => onToggle(u.id)}
                        className={`pm-rb-universe-chip${u.enabled ? " is-on" : " is-off"}`}
                    >
                        {u.label}
                    </button>
                ))}
            </div>
        </section>
    );
}

// --------------------------------------------------------------------- //
// Guardrails
// --------------------------------------------------------------------- //

function GuardrailsSection({
    guardrails,
    onChange,
}: {
    guardrails: StrategyGuardrails;
    onChange: <K extends keyof StrategyGuardrails>(
        key: K,
        value: StrategyGuardrails[K],
    ) => void;
}) {
    return (
        <section className="pm-rb-section" aria-labelledby="rb-guardrails">
            <header className="pm-rb-section-head">
                <h3 id="rb-guardrails" className="pm-rb-section-title">Guardrails</h3>
            </header>

            <div className="pm-rb-guardrails">
                <SliderRow
                    label="Max position"
                    hint="Cap per position as % of equity"
                    min={0.005}
                    max={0.30}
                    step={0.005}
                    value={guardrails.maxPositionPct}
                    onChange={(v) => onChange("maxPositionPct", v)}
                    format={(v) => `${(v * 100).toFixed(1)}%`}
                />
                <SliderRow
                    label="Stop loss"
                    hint="Hard exit on a single position"
                    min={0.02}
                    max={0.30}
                    step={0.005}
                    value={guardrails.stopLossPct}
                    onChange={(v) => onChange("stopLossPct", v)}
                    format={(v) => `${(v * 100).toFixed(1)}%`}
                />
                <SliderRow
                    label="Rebalance cadence"
                    hint="How often the screen re-runs"
                    min={1}
                    max={90}
                    step={1}
                    value={guardrails.rebalanceDays}
                    onChange={(v) => onChange("rebalanceDays", v)}
                    format={(v) => `${v} ${v === 1 ? "day" : "days"}`}
                />
            </div>
        </section>
    );
}

function SliderRow({
    label,
    hint,
    min,
    max,
    step,
    value,
    onChange,
    format,
}: {
    label: string;
    hint: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (v: number) => void;
    format: (v: number) => string;
}) {
    return (
        <div className="pm-rb-guardrail">
            <div className="pm-rb-guardrail-head">
                <span className="pm-rb-guardrail-label">{label}</span>
                <span className="pm-rb-guardrail-value num">{format(value)}</span>
            </div>
            <input
                type="range"
                className="pm-rb-guardrail-slider"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                aria-label={label}
            />
            <span className="pm-rb-guardrail-hint">{hint}</span>
        </div>
    );
}
