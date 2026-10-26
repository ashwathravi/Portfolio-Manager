"use client";

import { useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import {
    DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
    EMPLOYER_STOCK_PLAN_STATES,
    EMPLOYER_STOCK_TRIM_CADENCES,
    EMPLOYER_STOCK_TRIM_METHODS,
    EMPLOYER_STOCK_VEST_ACTIONS,
    computeEmployerStockDeRisking,
    type EmployerStockDeRiskingPlan,
    type EmployerStockPlanState,
    type EmployerStockTrimCadence,
    type EmployerStockTrimMethod,
    type EmployerStockVestAction,
    employerStockName,
    parseEmployerTickers,
    policyPortfolioValue,
} from "@/lib/risk-policy";
import { usePolicyPortfolio } from "@/components/providers/PolicyPortfolioProvider";
import { useSettingsStore } from "@/lib/stores/settingsStore";

const STATE_LABELS: Record<EmployerStockPlanState, string> = {
    draft: "Draft",
    active: "Active",
    paused: "Paused",
    completed: "Completed",
};

const METHOD_LABELS: Record<EmployerStockTrimMethod, string> = {
    fixed_amount: "Fixed amount",
    fixed_percent: "Fixed percent",
    vest_driven: "Vest-driven",
};

const VEST_ACTION_LABELS: Record<EmployerStockVestAction, string> = {
    sell_all: "Sell all new vest",
    sell_half: "Sell half new vest",
    hold: "Hold new vest",
};

/**
 * Employer stock (launch item i52): which tickers are the user's
 * employer's, and the plan for trimming them, previewed on the user's own
 * portfolio. Every employer-stock check (Today, Trade, stress tests, the
 * sell rules) reads the tickers named here; there are none until the user
 * names them.
 */
export function EmployerStockPlanCard() {
    const riskPolicy = useSettingsStore((s) => s.riskPolicy);
    const updateRiskPolicy = useSettingsStore((s) => s.updateRiskPolicy);
    const { portfolio } = usePolicyPortfolio();
    const plan = riskPolicy.employerStockPlan ?? DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN;
    const summary = useMemo(
        () =>
            computeEmployerStockDeRisking({
                holdings: portfolio.holdings,
                portfolioValue: policyPortfolioValue(portfolio),
                plan,
            }),
        [plan, portfolio],
    );
    const named = plan.symbols.length > 0;
    const name = employerStockName(plan.symbols);
    // Typed freely, then kept on blur or Enter: "GOOG, GOOGL".
    const [tickersDraft, setTickersDraft] = useState<string | null>(null);
    const commitTickers = () => {
        if (tickersDraft === null) return;
        updatePlan({ symbols: parseEmployerTickers(tickersDraft) });
        setTickersDraft(null);
    };

    const updatePlan = (updates: Partial<EmployerStockDeRiskingPlan>) => {
        updateRiskPolicy({
            employerStockPlan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                ...plan,
                ...updates,
                symbols: updates.symbols ? [...updates.symbols] : [...plan.symbols],
            },
        });
    };

    // Resets the plan's assumptions; the tickers stay the user's employer's.
    const resetPlan = () => {
        updateRiskPolicy({
            employerStockPlan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                symbols: [...plan.symbols],
            },
        });
    };

    return (
        <section
            id="employer-stock"
            className="pm-settings-card"
            aria-labelledby="pm-settings-employer-stock-head"
            data-testid="employer-stock-plan-card"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <Building2 className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-employer-stock-head"
                        className="pm-settings-card-title"
                    >
                        Employer stock
                    </h2>
                </div>
                <span className="pm-settings-card-sub">
                    {named ? summary.status.replace("_", " ") : "none named"}
                </span>
            </header>

            <div className="pm-settings-card-body pm-employer-plan-card-body">
                <label className="pm-settings-field">
                    <span className="pm-settings-field-label">Your employer&apos;s tickers</span>
                    <input
                        className="pm-settings-input"
                        value={tickersDraft ?? plan.symbols.join(", ")}
                        placeholder="e.g. GOOG, GOOGL"
                        onChange={(event) => setTickersDraft(event.target.value)}
                        onBlur={commitTickers}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") commitTickers();
                        }}
                        aria-label="Employer stock tickers"
                    />
                </label>
                <p className="pm-churn-policy-note" data-testid="employer-stock-note">
                    {named
                        ? `${name} is kept apart from other concentration: your portfolio and your income depend on the same company.`
                        : "If you hold your employer's stock, name its tickers: it's checked apart from other concentration, since your portfolio and your income depend on the same company."}
                </p>

                <div className="pm-employer-plan-summary" aria-label="Employer stock summary">
                    <div>
                        <span className="pm-cash-summary-label">Current</span>
                        <strong>{formatPct(summary.currentAllocationPct)}</strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Trim to target</span>
                        <strong>{formatUsd(summary.sellToTargetUsd)}</strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Next action</span>
                        <strong>{summary.nextAction ? formatUsd(summary.nextAction.sellUsd) : "None"}</strong>
                    </div>
                </div>

                <div className="pm-employer-plan-grid">
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">State</span>
                        <select
                            className="pm-settings-select"
                            value={plan.state}
                            onChange={(event) =>
                                updatePlan({ state: event.target.value as EmployerStockPlanState })
                            }
                            aria-label="Employer-stock plan state"
                        >
                            {EMPLOYER_STOCK_PLAN_STATES.map((state) => (
                                <option key={state} value={state}>
                                    {STATE_LABELS[state]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <NumberField
                        label="Employer target allocation"
                        shortLabel="Target"
                        value={plan.targetAllocationPct}
                        min={0}
                        max={100}
                        step={1}
                        onChange={(value) => updatePlan({ targetAllocationPct: clampNumber(value, 0, 100) })}
                    />
                    <NumberField
                        label="Employer intermediate target allocation"
                        shortLabel="Interim"
                        value={plan.intermediateTargetPct}
                        min={0}
                        max={100}
                        step={1}
                        onChange={(value) => updatePlan({ intermediateTargetPct: clampNumber(value, 0, 100) })}
                    />
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Method</span>
                        <select
                            className="pm-settings-select"
                            value={plan.trimMethod}
                            onChange={(event) =>
                                updatePlan({ trimMethod: event.target.value as EmployerStockTrimMethod })
                            }
                            aria-label="Employer trim method"
                        >
                            {EMPLOYER_STOCK_TRIM_METHODS.map((method) => (
                                <option key={method} value={method}>
                                    {METHOD_LABELS[method]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Cadence</span>
                        <select
                            className="pm-settings-select"
                            value={plan.trimCadence}
                            onChange={(event) =>
                                updatePlan({ trimCadence: event.target.value as EmployerStockTrimCadence })
                            }
                            aria-label="Employer trim cadence"
                        >
                            {EMPLOYER_STOCK_TRIM_CADENCES.map((cadence) => (
                                <option key={cadence} value={cadence}>
                                    {cadence === "quarterly" ? "Quarterly" : "Monthly"}
                                </option>
                            ))}
                        </select>
                    </label>
                    <NumberField
                        label="Employer trim amount"
                        shortLabel="Amount"
                        value={plan.trimAmountUsd}
                        min={0}
                        max={10_000_000}
                        step={1_000}
                        onChange={(value) => updatePlan({ trimAmountUsd: clampNumber(value, 0, 10_000_000) })}
                    />
                    <NumberField
                        label="Employer trim percent"
                        shortLabel="Percent"
                        value={plan.trimPercentOfPosition}
                        min={0}
                        max={100}
                        step={1}
                        onChange={(value) => updatePlan({ trimPercentOfPosition: clampNumber(value, 0, 100) })}
                    />
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Next due</span>
                        <input
                            type="date"
                            className="pm-settings-input"
                            value={plan.nextActionDate ?? ""}
                            onChange={(event) =>
                                updatePlan({ nextActionDate: event.target.value || undefined })
                            }
                            aria-label="Employer next action date"
                        />
                    </label>
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Vest date</span>
                        <input
                            type="date"
                            className="pm-settings-input"
                            value={plan.nextVestDate ?? ""}
                            onChange={(event) =>
                                updatePlan({ nextVestDate: event.target.value || undefined })
                            }
                            aria-label="Employer next vest date"
                        />
                    </label>
                    <NumberField
                        label="Employer planned vest value"
                        shortLabel="Vest value"
                        value={plan.plannedVestValueUsd}
                        min={0}
                        max={10_000_000}
                        step={1_000}
                        onChange={(value) => updatePlan({ plannedVestValueUsd: clampNumber(value, 0, 10_000_000) })}
                    />
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Vest action</span>
                        <select
                            className="pm-settings-select"
                            value={plan.defaultVestAction}
                            onChange={(event) =>
                                updatePlan({ defaultVestAction: event.target.value as EmployerStockVestAction })
                            }
                            aria-label="Employer default vest action"
                        >
                            {EMPLOYER_STOCK_VEST_ACTIONS.map((action) => (
                                <option key={action} value={action}>
                                    {VEST_ACTION_LABELS[action]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <NumberField
                        label="Employer tax reserve percent"
                        shortLabel="Tax %"
                        value={plan.taxReservePct}
                        min={0}
                        max={100}
                        step={1}
                        onChange={(value) => updatePlan({ taxReservePct: clampNumber(value, 0, 100) })}
                    />
                    <label className="pm-settings-field pm-employer-plan-destination">
                        <span className="pm-settings-field-label">Destination</span>
                        <input
                            className="pm-settings-input"
                            value={plan.destinationLabel}
                            onChange={(event) => updatePlan({ destinationLabel: event.target.value })}
                            aria-label="Employer destination"
                        />
                    </label>
                </div>

                {summary.schedule.length > 0 && (
                    <div className="pm-employer-plan-schedule" aria-label="Employer stock trim schedule">
                        {summary.schedule.slice(0, 3).map((step) => (
                            <div key={step.sequence} className="pm-employer-plan-step">
                                <span>{step.dueDate}</span>
                                <strong>{formatUsd(step.sellUsd)}</strong>
                                <span>{formatPct(step.projectedAllocationPct)} projected</span>
                            </div>
                        ))}
                    </div>
                )}

                <p className="pm-churn-policy-note">{summary.disclaimer}</p>

                <button
                    type="button"
                    className="pm-settings-card-cta pm-employer-plan-reset-button"
                    onClick={resetPlan}
                >
                    Reset plan
                </button>
            </div>
        </section>
    );
}

function NumberField({
    label,
    shortLabel,
    value,
    min,
    max,
    step,
    onChange,
}: {
    label: string;
    shortLabel: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: string) => void;
}) {
    return (
        <label className="pm-settings-field">
            <span className="pm-settings-field-label">{shortLabel}</span>
            <input
                type="number"
                min={min}
                max={max}
                step={step}
                className="pm-settings-input"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-label={label}
            />
        </label>
    );
}

function clampNumber(value: string, min: number, max: number): number {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
}

function formatPct(value: number): string {
    if (!Number.isFinite(value)) return "0.0%";
    return `${value.toFixed(1)}%`;
}

function formatUsd(value: number): string {
    return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    });
}
