"use client";

import { useState, type FormEvent } from "react";
import { X, Plus } from "lucide-react";
import { TickerSearchInput } from "@/components/command/TickerSearchInput";
import { INDICATOR_PRESETS, parseIndicator, parseOperand } from "@/lib/strategies/indicators";
import {
    opLabel,
    STRATEGY_LIMITS,
    STRATEGY_OPS,
    type Strategy,
    type StrategyConjunction,
    type StrategyGuardrails,
    type StrategyRule,
} from "@/lib/strategies/strategy";
import { tickerSchema } from "@/lib/validators/market-data";

/**
 * Rule builder · Tickers · Guardrails (AR-81).
 *
 * The left side of the builder split. Lets the user compose the decision
 * logic the backtest runs (launch item i55):
 *
 *   1. RULES — flat list of (indicator, op, value) conditions glued by
 *      AND/OR pills; AND binds tighter. The value is a number or another
 *      indicator, and one the engine can't read is marked as typed.
 *   2. TICKERS — what the strategy may hold: added by ticker or company
 *      name, or a preset (index or sector ETFs).
 *   3. GUARDRAILS — max position, stop loss, and how often the rules are
 *      checked.
 *
 * Purely controlled. The parent owns the strategies and passes typed
 * callbacks, so edits go through the reducer helpers in `strategy.ts`.
 */

/** The benchmark ETFs the price store always keeps (price-ingest.ts), so these backtest from day one. */
const INDEX_ETFS = ["SPY", "QQQ", "DIA", "IWM"];
const SECTOR_ETFS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"];

export interface RuleBuilderPanelProps {
    strategy: Strategy;
    onChangeRule: (ruleId: string, patch: Partial<StrategyRule>) => void;
    onAddRule: () => void;
    onRemoveRule: (ruleId: string) => void;
    onChangeConjunction: (index: number, next: StrategyConjunction) => void;
    onAddSymbols: (symbols: readonly string[]) => void;
    onRemoveSymbol: (symbol: string) => void;
    onChangeGuardrail: <K extends keyof StrategyGuardrails>(
        key: K,
        value: StrategyGuardrails[K],
    ) => void;
    /** Renames the strategy; absent for the examples, whose names stay. */
    onRename?: (name: string) => void;
}

export function RuleBuilderPanel(props: RuleBuilderPanelProps) {
    const { strategy } = props;

    return (
        <div className="pm-rule-builder pm-card">
            {props.onRename && (
                <label className="pm-rb-name">
                    <span className="pm-rb-section-title">Name</span>
                    <input
                        className="pm-exec-input"
                        value={strategy.name}
                        maxLength={STRATEGY_LIMITS.name}
                        onChange={(e) => props.onRename!(e.target.value)}
                        aria-label="Strategy name"
                    />
                </label>
            )}
            <RulesSection {...props} />
            <TickersSection symbols={strategy.symbols} onAdd={props.onAddSymbols} onRemove={props.onRemoveSymbol} />
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
                    disabled={rules.length >= STRATEGY_LIMITS.rules}
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
    const presets: readonly string[] = INDICATOR_PRESETS;
    const valueOk = parseOperand(rule.value) !== null;
    const fieldOk = parseIndicator(rule.field) !== null;
    return (
        <div className="pm-rb-rule">
            <select
                className="pm-rb-field"
                value={rule.field}
                onChange={(e) => onChange({ field: e.target.value })}
                aria-label="Field"
                aria-invalid={!fieldOk || undefined}
            >
                {presets.includes(rule.field) ? null : (
                    <option value={rule.field}>{rule.field}</option>
                )}
                {presets.map((f) => (
                    <option key={f} value={f}>{f}</option>
                ))}
            </select>

            <select
                className="pm-rb-op"
                value={rule.op}
                onChange={(e) => onChange({ op: e.target.value as StrategyRule["op"] })}
                aria-label="Operator"
            >
                {STRATEGY_OPS.map((op) => (
                    <option key={op} value={op}>{opLabel(op)}</option>
                ))}
            </select>

            <input
                type="text"
                className="pm-rb-value"
                value={rule.value}
                maxLength={STRATEGY_LIMITS.ruleText}
                onChange={(e) => onChange({ value: e.target.value })}
                aria-label="Value"
                aria-invalid={!valueOk || undefined}
                title={valueOk ? undefined : "A number (30, 10%, $5M) or an indicator (SMA(50), RSI(14), Mom(6M))"}
                placeholder="30 or SMA(50)"
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
// Tickers
// --------------------------------------------------------------------- //

function TickersSection({
    symbols,
    onAdd,
    onRemove,
}: {
    symbols: string[];
    onAdd: (symbols: readonly string[]) => void;
    onRemove: (symbol: string) => void;
}) {
    const [draft, setDraft] = useState("");
    const [error, setError] = useState<string | null>(null);
    const full = symbols.length >= STRATEGY_LIMITS.symbols;
    const add = (list: readonly string[]) => {
        onAdd(list);
        setDraft("");
        setError(null);
    };
    const submit = (e: FormEvent) => {
        e.preventDefault();
        const symbol = draft.trim().toUpperCase();
        if (!symbol) return;
        if (!tickerSchema.safeParse(symbol).success) {
            setError(`"${draft.trim()}" isn't a ticker. Type one, or pick a company from the list.`);
            return;
        }
        add([symbol]);
    };
    return (
        <section className="pm-rb-section" aria-labelledby="rb-universe">
            <header className="pm-rb-section-head">
                <h3 id="rb-universe" className="pm-rb-section-title">Tickers</h3>
                <span className="pm-rb-section-hint">
                    {symbols.length} of {STRATEGY_LIMITS.symbols}
                </span>
            </header>
            <div className="pm-rb-universe-chips" data-testid="strategy-tickers">
                {symbols.length === 0 && <span className="pm-rb-section-hint">No tickers yet: add what the strategy may hold.</span>}
                {symbols.map((symbol) => (
                    <span key={symbol} className="pm-rb-universe-chip is-on">
                        {symbol}
                        <button type="button" className="pm-rb-chip-del" onClick={() => onRemove(symbol)} aria-label={`Remove ${symbol}`}>
                            <X size={12} aria-hidden="true" />
                        </button>
                    </span>
                ))}
            </div>
            <form className="pm-rb-ticker-add" onSubmit={submit}>
                <TickerSearchInput
                    value={draft}
                    onChange={(v) => {
                        setDraft(v);
                        setError(null);
                    }}
                    onPick={(match) => add([match.symbol])}
                    placeholder="Add ticker or company"
                    aria-label="Add ticker to strategy"
                    aria-invalid={error ? true : undefined}
                    maxLength={40}
                />
                <button type="submit" className="pm-btn pm-btn-ghost" disabled={full}>Add</button>
            </form>
            <div className="pm-rb-presets">
                <button type="button" className="pm-rb-preset" onClick={() => add(INDEX_ETFS)} disabled={full}>+ Index ETFs</button>
                <button type="button" className="pm-rb-preset" onClick={() => add(SECTOR_ETFS)} disabled={full}>+ Sector ETFs</button>
            </div>
            {error && <p className="pm-rb-error" role="alert">{error}</p>}
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
                    hint="Each buy, as % of equity"
                    min={0.005}
                    max={1}
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
                    hint="How often the rules are checked"
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
