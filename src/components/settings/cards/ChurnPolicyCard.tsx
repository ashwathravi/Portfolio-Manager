"use client";

import { useMemo } from "react";
import { Repeat2 } from "lucide-react";
import { mockTransactions } from "@/lib/mockData";
import { computeChurnAnalysis } from "@/lib/risk-policy";
import { useSettingsStore } from "@/lib/stores/settingsStore";

const DEFAULT_CHURN_POLICY = {
    windowDays: 90,
    watchRepeatSymbols: 1,
    breachRepeatSymbols: 3,
};

export function ChurnPolicyCard() {
    const riskPolicy = useSettingsStore((s) => s.riskPolicy);
    const updateRiskPolicy = useSettingsStore((s) => s.updateRiskPolicy);
    const policy = riskPolicy.churnPolicy ?? DEFAULT_CHURN_POLICY;
    const summary = useMemo(
        () =>
            computeChurnAnalysis(mockTransactions, {
                windowDays: policy.windowDays,
                watchRepeatSymbols: policy.watchRepeatSymbols,
                breachRepeatSymbols: policy.breachRepeatSymbols,
            }),
        [policy.windowDays, policy.watchRepeatSymbols, policy.breachRepeatSymbols],
    );
    const status = summary.status;

    const updatePolicy = (updates: Partial<typeof DEFAULT_CHURN_POLICY>) => {
        updateRiskPolicy({
            churnPolicy: {
                ...policy,
                ...updates,
            },
        });
    };

    const resetDefaults = () => {
        updateRiskPolicy({ churnPolicy: { ...DEFAULT_CHURN_POLICY } });
    };

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-churn-policy-head"
            data-testid="churn-policy-card"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <Repeat2 className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-churn-policy-head"
                        className="pm-settings-card-title"
                    >
                        Trading activity
                    </h2>
                </div>
                <span className="pm-settings-card-sub">
                    {summary.repeatSymbolCount} repeated names
                </span>
            </header>

            <div className="pm-settings-card-body pm-churn-card-body">
                <div className="pm-churn-summary" aria-label="Trading activity summary">
                    <div>
                        <span className="pm-cash-summary-label">Status</span>
                        <strong data-status={status}>{status.replace("_", " ")}</strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Turnover</span>
                        <strong>{formatUsd(summary.repeatTurnoverUsd)}</strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Names</span>
                        <strong>{summary.repeatSymbols.join(", ") || "None"}</strong>
                    </div>
                </div>

                {summary.rows[0] && (
                    <div
                        className="pm-churn-warning"
                        data-testid="churn-policy-warning"
                        data-status={summary.rows[0].status}
                    >
                        <strong>{summary.rows[0].symbol} score {summary.rows[0].churnScore}</strong>
                        <span>{summary.rows[0].recommendation}</span>
                    </div>
                )}

                <div className="pm-churn-policy-grid">
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Lookback</span>
                        <input
                            type="number"
                            min={14}
                            max={365}
                            step={1}
                            className="pm-settings-input"
                            value={policy.windowDays}
                            onChange={(event) =>
                                updatePolicy({ windowDays: clampInt(event.target.value, 14, 365) })
                            }
                            aria-label="Churn lookback days"
                        />
                    </label>
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Watch</span>
                        <input
                            type="number"
                            min={1}
                            max={25}
                            step={1}
                            className="pm-settings-input"
                            value={policy.watchRepeatSymbols}
                            onChange={(event) =>
                                updatePolicy({ watchRepeatSymbols: clampInt(event.target.value, 1, 25) })
                            }
                            aria-label="Churn watch repeated names"
                        />
                    </label>
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Breach</span>
                        <input
                            type="number"
                            min={1}
                            max={25}
                            step={1}
                            className="pm-settings-input"
                            value={policy.breachRepeatSymbols}
                            onChange={(event) =>
                                updatePolicy({ breachRepeatSymbols: clampInt(event.target.value, 1, 25) })
                            }
                            aria-label="Churn breach repeated names"
                        />
                    </label>
                </div>

                <p className="pm-churn-policy-note">
                    Repeated buys and sells in the same names are treated as weekly-review work before the next trade.
                </p>

                <button
                    type="button"
                    className="pm-settings-card-cta pm-churn-reset-button"
                    onClick={resetDefaults}
                >
                    Reset activity policy
                </button>
            </div>
        </section>
    );
}

function clampInt(value: string, min: number, max: number): number {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function formatUsd(value: number): string {
    return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    });
}
