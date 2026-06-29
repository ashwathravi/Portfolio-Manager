"use client";

import { useMemo } from "react";
import { CalendarClock, Wallet } from "lucide-react";
import {
    CASH_JOB_LABELS,
    computeCashPolicySummary,
    DEFAULT_CASH_DEPLOYMENT_RULE,
    type CashDeploymentRule,
    type CashJob,
    type CashJobType,
} from "@/lib/risk-policy";
import { useSettingsStore } from "@/lib/stores/settingsStore";

const CASH_JOB_FIELDS: Array<{
    type: CashJobType;
    helper: string;
}> = [
    { type: "emergency_fund", helper: "Emergency reserve" },
    { type: "tax_reserve", helper: "Taxes and known liabilities" },
    { type: "near_term_spending", helper: "Home, family, or spending needs" },
    { type: "opportunistic_reserve", helper: "Dry powder by rule" },
    { type: "scheduled_deployment", helper: "Cash queued for core buys" },
    { type: "settlement", helper: "Pending transfer or settlement" },
    { type: "unassigned", helper: "Temporarily unallocated" },
];

const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
});

export function CashJobsCard() {
    const riskPolicy = useSettingsStore((s) => s.riskPolicy);
    const updateRiskPolicy = useSettingsStore((s) => s.updateRiskPolicy);
    const cashJobs = riskPolicy.cashJobs;
    const deploymentRule = riskPolicy.cashDeploymentRule ?? DEFAULT_CASH_DEPLOYMENT_RULE;
    const classifiedTotal = cashJobs.reduce((sum, job) => sum + Math.max(0, job.amount), 0);
    const summary = useMemo(
        () =>
            computeCashPolicySummary({
                totalCash: classifiedTotal,
                jobs: cashJobs,
                deploymentRule,
            }),
        [cashJobs, classifiedTotal, deploymentRule],
    );

    const updateJobAmount = (type: CashJobType, value: string) => {
        const amount = Math.max(0, Math.round(Number(value || 0)));
        const existingJobs = cashJobs.filter((job) => job.type !== type);
        const existing = cashJobs.find((job) => job.type === type);
        const nextJobs = amount > 0
            ? [
                ...existingJobs,
                {
                    ...(existing ?? buildCashJob(type)),
                    amount,
                },
            ]
            : existingJobs;

        updateRiskPolicy({
            cashJobs: sortCashJobs(nextJobs),
        });
    };

    const updateDeploymentRule = (updates: Partial<CashDeploymentRule>) => {
        updateRiskPolicy({
            cashDeploymentRule: {
                ...DEFAULT_CASH_DEPLOYMENT_RULE,
                ...deploymentRule,
                ...updates,
            },
        });
    };

    const acknowledgeUnassigned = () => {
        const reviewBy = new Date();
        reviewBy.setDate(reviewBy.getDate() + 30);
        updateDeploymentRule({
            unassignedAcknowledgedUntil: reviewBy.toISOString().slice(0, 10),
        });
    };

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-cash-jobs-head"
            data-testid="cash-jobs-card"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <Wallet className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-cash-jobs-head"
                        className="pm-settings-card-title"
                    >
                        Cash jobs
                    </h2>
                </div>
                <span className="pm-settings-card-sub">
                    {summary.status.replace("_", " ")}
                </span>
            </header>

            <div className="pm-settings-card-body pm-cash-jobs-card-body">
                <div className="pm-cash-summary" aria-label="Cash job summary">
                    <div>
                        <span className="pm-cash-summary-label">Classified</span>
                        <strong data-testid="cash-jobs-classified-total">
                            {CURRENCY_FORMAT.format(classifiedTotal)}
                        </strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Reserved</span>
                        <strong>{CURRENCY_FORMAT.format(summary.reservedCash)}</strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Excess</span>
                        <strong>{CURRENCY_FORMAT.format(summary.excessCash)}</strong>
                    </div>
                </div>

                <div className="pm-cash-job-grid">
                    {CASH_JOB_FIELDS.map(({ type, helper }) => {
                        const amount = cashJobs.find((job) => job.type === type)?.amount ?? 0;
                        return (
                            <label key={type} className="pm-cash-job-field">
                                <span className="pm-cash-job-field-head">
                                    <span>{CASH_JOB_LABELS[type]}</span>
                                    <span>{helper}</span>
                                </span>
                                <input
                                    type="number"
                                    min={0}
                                    step={1_000}
                                    className="pm-settings-input"
                                    value={amount > 0 ? amount : ""}
                                    onChange={(event) => updateJobAmount(type, event.target.value)}
                                    aria-label={`${CASH_JOB_LABELS[type]} cash amount`}
                                    inputMode="numeric"
                                />
                            </label>
                        );
                    })}
                </div>

                <div className="pm-cash-deployment-panel">
                    <div className="pm-cash-deployment-head">
                        <div className="pm-settings-card-head-left">
                            <CalendarClock className="pm-settings-card-icon" aria-hidden="true" />
                            <span className="pm-cash-deployment-title">Scheduled deployment</span>
                        </div>
                        <label className="pm-switch" aria-label="Enable scheduled deployment rule">
                            <input
                                type="checkbox"
                                checked={deploymentRule.enabled}
                                onChange={(event) =>
                                    updateDeploymentRule({ enabled: event.target.checked })
                                }
                            />
                            <span />
                        </label>
                    </div>

                    <div className="pm-cash-deployment-grid">
                        <label className="pm-settings-field">
                            <span className="pm-settings-field-label">Cadence</span>
                            <select
                                className="pm-settings-select"
                                value={deploymentRule.cadence}
                                onChange={(event) =>
                                    updateDeploymentRule({
                                        cadence: event.target.value === "quarterly" ? "quarterly" : "monthly",
                                    })
                                }
                                aria-label="Deployment cadence"
                            >
                                <option value="monthly">Monthly</option>
                                <option value="quarterly">Quarterly</option>
                            </select>
                        </label>
                        <label className="pm-settings-field">
                            <span className="pm-settings-field-label">Percent</span>
                            <input
                                type="number"
                                min={0}
                                max={100}
                                step={1}
                                className="pm-settings-input"
                                value={deploymentRule.percentOfExcess}
                                onChange={(event) =>
                                    updateDeploymentRule({
                                        percentOfExcess: Math.max(0, Math.min(100, Number(event.target.value || 0))),
                                    })
                                }
                                aria-label="Percent of excess cash to deploy"
                            />
                        </label>
                        <label className="pm-settings-field">
                            <span className="pm-settings-field-label">Destination</span>
                            <input
                                className="pm-settings-input"
                                value={deploymentRule.destination}
                                onChange={(event) =>
                                    updateDeploymentRule({ destination: event.target.value })
                                }
                                aria-label="Deployment destination"
                            />
                        </label>
                        <label className="pm-settings-field">
                            <span className="pm-settings-field-label">Next due</span>
                            <input
                                type="date"
                                className="pm-settings-input"
                                value={deploymentRule.nextDueDate ?? ""}
                                onChange={(event) =>
                                    updateDeploymentRule({
                                        nextDueDate: event.target.value || undefined,
                                    })
                                }
                                aria-label="Next deployment due date"
                            />
                        </label>
                    </div>
                    <button
                        type="button"
                        className="pm-settings-card-cta pm-cash-ack-button"
                        onClick={acknowledgeUnassigned}
                    >
                        Keep unassigned for 30 days
                    </button>
                </div>
            </div>
        </section>
    );
}

function buildCashJob(type: CashJobType): CashJob {
    return {
        id: `cash-${type}`,
        type,
        label: CASH_JOB_LABELS[type],
        amount: 0,
    };
}

function sortCashJobs(jobs: CashJob[]): CashJob[] {
    return [...jobs].sort(
        (a, b) => CASH_JOB_FIELDS.findIndex((field) => field.type === a.type)
            - CASH_JOB_FIELDS.findIndex((field) => field.type === b.type),
    );
}
