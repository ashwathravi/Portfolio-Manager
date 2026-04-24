"use client";

import { X, Plus, ShieldCheck, ShieldAlert } from "lucide-react";
import { useState } from "react";
import {
    ADHERENCE_RULE_META,
    ADHERENCE_RULE_ORDER,
    buildDefaultRule,
    type AdherenceRule,
    type AdherenceRuleType,
    type AdherenceRuleParams,
    type AdherenceSeverity,
} from "@/lib/adherence/rules";

/**
 * AR-111 Adherence rules editor.
 *
 * CRUD surface for the seven-rule discipline palette. Rendered on the
 * Strategies builder below the existing entry-rules section — they're
 * different concepts (pick stocks vs. constrain how you trade) but
 * the visual rhythm of a card with a section header, rule rows, and
 * an "Add rule" button carries over so users don't have to relearn
 * the idiom.
 *
 * Each row is:
 *   [severity pill] · [rule title] · [N typed param inputs] · [delete]
 *
 * The severity pill doubles as a tone indicator (hard = red tint, soft
 * = amber) and a click target to flip the severity in place — avoids
 * a nested modal and keeps the row one-line.
 *
 * Adds go through a small pop-over driven by a controlled `<select>` so
 * the rule palette is scannable without a larger dropdown component.
 */

export interface AdherenceRulesPanelProps {
    rules: ReadonlyArray<AdherenceRule>;
    /** Called with the full next array. Parent owns the list. */
    onChange: (next: AdherenceRule[]) => void;
    /** Optional rolling adherence readout rendered in the section header.
     *  `null` means "no data yet" — the header hides the readout rather
     *  than asserting a misleading 100/100. */
    adherenceScore?: number | null;
    /** When `adherenceScore` is set, this is the tier the parent computes
     *  via `adherenceTier()`. Drives the medal copy ("best quartile"). */
    adherenceTier?: 'top' | 'good' | 'ok' | 'low' | null;
}

export function AdherenceRulesPanel({
    rules,
    onChange,
    adherenceScore,
    adherenceTier,
}: AdherenceRulesPanelProps) {
    const [pickerOpen, setPickerOpen] = useState(false);

    const addRule = (type: AdherenceRuleType) => {
        onChange([...rules, buildDefaultRule(type)]);
        setPickerOpen(false);
    };

    const removeRule = (id: string) => {
        onChange(rules.filter((r) => r.id !== id));
    };

    const updateRule = (id: string, patch: Partial<AdherenceRule>) => {
        onChange(
            rules.map((r) =>
                r.id === id
                    ? {
                          ...r,
                          ...patch,
                          params: patch.params
                              ? { ...r.params, ...patch.params }
                              : r.params,
                      }
                    : r,
            ),
        );
    };

    return (
        <section
            className="pm-card pm-adherence-panel"
            aria-labelledby="pm-adherence-head"
            data-testid="adherence-rules-panel"
        >
            <header className="pm-rb-section-head">
                <div className="pm-adherence-head-lede">
                    <h3 id="pm-adherence-head" className="pm-rb-section-title">
                        Discipline rules
                    </h3>
                    {adherenceScore != null && (
                        <AdherenceBadge
                            score={adherenceScore}
                            tier={adherenceTier ?? null}
                        />
                    )}
                </div>
                <div className="pm-adherence-head-actions">
                    {pickerOpen ? (
                        <AddRulePicker
                            onPick={addRule}
                            onCancel={() => setPickerOpen(false)}
                        />
                    ) : (
                        <button
                            type="button"
                            className="pm-rb-add-rule"
                            onClick={() => setPickerOpen(true)}
                            aria-label="Add adherence rule"
                            data-testid="adherence-rules-add"
                        >
                            <Plus className="pm-rb-add-icon" aria-hidden="true" />
                            Add rule
                        </button>
                    )}
                </div>
            </header>

            {rules.length === 0 ? (
                <div className="pm-rb-empty" data-testid="adherence-rules-empty">
                    No discipline rules yet. Add one to start scoring every
                    trade at submit against the rules you've agreed with
                    yourself.
                </div>
            ) : (
                <ul className="pm-adherence-list" role="list">
                    {rules.map((rule) => (
                        <AdherenceRuleRow
                            key={rule.id}
                            rule={rule}
                            onRemove={() => removeRule(rule.id)}
                            onChange={(patch) => updateRule(rule.id, patch)}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}

// --------------------------------------------------------------------- //
// Rule row
// --------------------------------------------------------------------- //

function AdherenceRuleRow({
    rule,
    onRemove,
    onChange,
}: {
    rule: AdherenceRule;
    onRemove: () => void;
    onChange: (patch: Partial<AdherenceRule>) => void;
}) {
    const meta = ADHERENCE_RULE_META[rule.type];
    return (
        <li
            className="pm-adherence-row"
            data-rule-type={rule.type}
            data-severity={rule.severity}
        >
            <SeverityPill
                severity={rule.severity}
                onToggle={() =>
                    onChange({
                        severity: rule.severity === 'hard' ? 'soft' : 'hard',
                    })
                }
            />
            <div className="pm-adherence-body">
                <p className="pm-adherence-title">{meta.title}</p>
                <p className="pm-adherence-desc">{meta.shortDesc}</p>
            </div>
            {meta.paramSpec.length > 0 ? (
                <div className="pm-adherence-params">
                    {meta.paramSpec.map((spec) => (
                        <ParamInput
                            key={spec.key}
                            spec={spec}
                            rule={rule}
                            onChange={(params) => onChange({ params })}
                        />
                    ))}
                </div>
            ) : (
                <span className="pm-adherence-param-empty">No parameters</span>
            )}
            <button
                type="button"
                className="pm-rb-rule-del"
                onClick={onRemove}
                aria-label={`Remove ${meta.title} rule`}
            >
                <X className="pm-rb-del-icon" aria-hidden="true" />
            </button>
        </li>
    );
}

// --------------------------------------------------------------------- //
// Severity
// --------------------------------------------------------------------- //

function SeverityPill({
    severity,
    onToggle,
}: {
    severity: AdherenceSeverity;
    onToggle: () => void;
}) {
    const Icon = severity === 'hard' ? ShieldAlert : ShieldCheck;
    return (
        <button
            type="button"
            className={`pm-adherence-sev pm-adherence-sev-${severity}`}
            onClick={onToggle}
            aria-label={`Severity ${severity}. Click to toggle.`}
            title="Toggle severity"
        >
            <Icon className="pm-adherence-sev-icon" aria-hidden="true" />
            <span className="pm-adherence-sev-label">{severity}</span>
        </button>
    );
}

// --------------------------------------------------------------------- //
// Param inputs
// --------------------------------------------------------------------- //

function ParamInput({
    spec,
    rule,
    onChange,
}: {
    spec: (typeof ADHERENCE_RULE_META)[AdherenceRuleType]['paramSpec'][number];
    rule: AdherenceRule;
    onChange: (params: AdherenceRuleParams) => void;
}) {
    const key = spec.key;
    const current = rule.params[key];

    if (spec.kind === 'sector') {
        return (
            <label className="pm-adherence-param">
                <span className="pm-adherence-param-label">{spec.label}</span>
                <input
                    type="text"
                    className="pm-adherence-param-text"
                    value={typeof current === 'string' ? current : ''}
                    onChange={(e) => onChange({ [key]: e.target.value })}
                    aria-label={spec.label}
                />
            </label>
        );
    }

    // percent / number / hour — all numeric inputs, same control.
    return (
        <label className="pm-adherence-param">
            <span className="pm-adherence-param-label">{spec.label}</span>
            <span className="pm-adherence-param-input-wrap">
                <input
                    type="number"
                    className="pm-adherence-param-num"
                    value={typeof current === 'number' ? current : ''}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    onChange={(e) => {
                        const v = e.target.value === '' ? undefined : Number(e.target.value);
                        onChange({ [key]: v });
                    }}
                    aria-label={spec.label}
                />
                {spec.suffix && (
                    <span className="pm-adherence-param-suffix" aria-hidden="true">
                        {spec.suffix}
                    </span>
                )}
            </span>
        </label>
    );
}

// --------------------------------------------------------------------- //
// Add-rule picker
// --------------------------------------------------------------------- //

function AddRulePicker({
    onPick,
    onCancel,
}: {
    onPick: (type: AdherenceRuleType) => void;
    onCancel: () => void;
}) {
    return (
        <div className="pm-adherence-picker" role="dialog" aria-label="Pick rule type">
            <select
                className="pm-adherence-picker-select"
                autoFocus
                defaultValue=""
                onChange={(e) => {
                    const v = e.target.value as AdherenceRuleType | '';
                    if (v) onPick(v);
                }}
            >
                <option value="" disabled>
                    Pick a rule…
                </option>
                {ADHERENCE_RULE_ORDER.map((type) => {
                    const meta = ADHERENCE_RULE_META[type];
                    return (
                        <option key={type} value={type}>
                            {meta.title}
                        </option>
                    );
                })}
            </select>
            <button
                type="button"
                className="pm-btn pm-btn-ghost pm-adherence-picker-cancel"
                onClick={onCancel}
            >
                Cancel
            </button>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Section header badge
// --------------------------------------------------------------------- //

function AdherenceBadge({
    score,
    tier,
}: {
    score: number;
    tier: 'top' | 'good' | 'ok' | 'low' | null;
}) {
    const copy =
        tier === 'top'
            ? 'best quartile'
            : tier === 'good'
                ? 'strong'
                : tier === 'ok'
                    ? 'room to improve'
                    : 'needs attention';
    return (
        <span
            className="pm-adherence-badge"
            data-tier={tier ?? 'none'}
            data-testid="adherence-score-badge"
            aria-label={`Rolling 30-day adherence: ${score} of 100, ${copy}`}
        >
            <span className="pm-adherence-badge-score">{score}</span>
            <span className="pm-adherence-badge-max">/ 100</span>
            <span className="pm-adherence-badge-copy">{copy}</span>
        </span>
    );
}
