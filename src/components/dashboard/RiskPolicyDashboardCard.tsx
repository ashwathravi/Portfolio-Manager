"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import {
    computeRiskPolicyDashboard,
    SELL_DISCIPLINE_ACTION_LABELS,
    type OptionRiskPosition,
    type EmployerStockDeRiskingSummary,
    type RiskPolicyDashboardHolding,
    type RiskPolicyDashboardTrade,
    RiskPolicyDashboardSummary,
    RiskPolicyDimension,
    RiskPolicyDimensionStatus,
    RiskPolicyNextAction,
    type SellDisciplineTask,
    type SellDisciplineThesis,
    type StressScenarioResult,
} from "@/lib/risk-policy";
import { useSettingsStore } from "@/lib/stores/settingsStore";

export interface RiskPolicyDashboardCardInput {
    holdings: RiskPolicyDashboardHolding[];
    cashTotal: number;
    trades?: RiskPolicyDashboardTrade[];
    optionPositions?: OptionRiskPosition[];
    theses?: SellDisciplineThesis[];
}

export interface RiskPolicyDashboardCardProps {
    summary: RiskPolicyDashboardSummary;
    input?: RiskPolicyDashboardCardInput;
}

const STATUS_LABELS: Record<RiskPolicyDimensionStatus, string> = {
    inside: "Inside policy",
    watch: "Watch",
    breached: "Breached",
    missing_data: "Missing data",
};

export function RiskPolicyDashboardCard({
    summary: initialSummary,
    input,
}: RiskPolicyDashboardCardProps) {
    const riskPolicy = useSettingsStore((s) => s.riskPolicy);
    const summary = useMemo(() => {
        if (!input) return initialSummary;
        const churnPolicy = riskPolicy.churnPolicy ?? {
            windowDays: 90,
            watchRepeatSymbols: 1,
            breachRepeatSymbols: 3,
        };

        return computeRiskPolicyDashboard({
            ...input,
            bucketPolicies: riskPolicy.bucketPolicies,
            themeCaps: riskPolicy.themeCaps,
            cashJobs: riskPolicy.cashJobs,
            cashDeploymentRule: riskPolicy.cashDeploymentRule,
            employerStockPlan: riskPolicy.employerStockPlan,
            optionPositions: input.optionPositions,
            optionsRiskPolicy: riskPolicy.optionsRiskPolicy,
            sellDisciplineRules: riskPolicy.sellDisciplineRules,
            theses: input.theses,
            options: {
                churnWindowDays: churnPolicy.windowDays,
                churnWatchRepeatSymbols: churnPolicy.watchRepeatSymbols,
                churnBreachRepeatSymbols: churnPolicy.breachRepeatSymbols,
            },
        });
    }, [initialSummary, input, riskPolicy]);
    const headline = buildHeadline(summary);

    return (
        <section
            className="pm-card pm-card-stack pm-risk-policy-card"
            data-testid="risk-policy-dashboard"
            data-status={summary.overallStatus}
            aria-labelledby="pm-risk-policy-head"
        >
            <header className="pm-card-header pm-risk-policy-header">
                <div>
                    <p className="pm-risk-policy-eyebrow">
                        <ShieldAlert size={14} aria-hidden="true" />
                        <span>Risk Policy Engine</span>
                    </p>
                    <h3 id="pm-risk-policy-head" className="pm-card-title">
                        Portfolio risk policy
                    </h3>
                    <p className="pm-card-subtitle">
                        {headline}
                    </p>
                </div>
                <div className="pm-risk-policy-counts" aria-label="Risk policy status counts">
                    <StatusCount label="Breached" value={summary.statusCounts.breached} status="breached" />
                    <StatusCount label="Watch" value={summary.statusCounts.watch} status="watch" />
                    <StatusCount label="Missing" value={summary.statusCounts.missing_data} status="missing_data" />
                </div>
            </header>

            <div className="pm-risk-policy-layout">
                <div
                    className="pm-risk-policy-dimensions"
                    role="list"
                    aria-label="Risk policy dimensions"
                >
                    {summary.dimensions.map((dimension) => (
                        <RiskPolicyDimensionRow
                            key={dimension.id}
                            dimension={dimension}
                        />
                    ))}
                </div>

                <aside
                    className="pm-risk-policy-actions"
                    aria-label="Risk policy next actions"
                >
                    <div>
                        <h4 className="pm-risk-policy-section-title">Next actions</h4>
                        <p className="pm-card-subtitle">
                            Sorted by breached and missing-data states first.
                        </p>
                    </div>
                    <div className="pm-risk-policy-action-list">
                        {summary.employerStockPlan.nextAction && (
                            <EmployerStockPlanTaskCard summary={summary.employerStockPlan} />
                        )}
                        {summary.sellDisciplineTasks.length > 0 && (
                            <div
                                className="pm-sell-task-list"
                                data-testid="sell-discipline-tasks"
                                aria-label="Sell discipline tasks"
                            >
                                {summary.sellDisciplineTasks.slice(0, 3).map((task) => (
                                    <SellDisciplineTaskCard key={task.ruleId} task={task} />
                                ))}
                            </div>
                        )}
                        {summary.nextActions.length === 0 ? (
                            <p className="pm-risk-policy-empty">
                                No policy action required from the current connected data.
                            </p>
                        ) : (
                            summary.nextActions.map((action) => (
                                <RiskPolicyAction
                                    key={`${action.id}-${action.href}`}
                                    action={action}
                                />
                            ))
                        )}
                    </div>

                    <StressTestPanel results={summary.stressTests} />

                    <nav
                        className="pm-risk-policy-link-grid"
                        aria-label="Risk policy deep links"
                    >
                        <PolicyLink href="/portfolios/holdings" label="Holdings" />
                        <PolicyLink href="/execution" label="Execution" />
                        <PolicyLink href="/research" label="Research theses" />
                        <PolicyLink href="/settings" label="Guardrails" />
                        <PolicyLink href="/#weekly-review" label="Weekly review" />
                    </nav>
                </aside>
            </div>
        </section>
    );
}

function StressTestPanel({ results }: { results: StressScenarioResult[] }) {
    const [selectedId, setSelectedId] = useState(results[0]?.scenarioId ?? "");
    const selected = results.find((result) => result.scenarioId === selectedId) ?? results[0];
    if (!selected) return null;

    return (
        <section
            className="pm-stress-panel"
            data-testid="stress-test-panel"
            aria-labelledby="pm-stress-test-head"
        >
            <div className="pm-stress-panel-head">
                <div>
                    <h4 id="pm-stress-test-head" className="pm-risk-policy-section-title">
                        Scenario stress test
                    </h4>
                    <p className="pm-card-subtitle">
                        Deterministic what-if, not a forecast.
                    </p>
                </div>
                <select
                    className="pm-settings-select pm-stress-select"
                    value={selected.scenarioId}
                    onChange={(event) => setSelectedId(event.target.value)}
                    aria-label="Stress-test scenario"
                >
                    {results.map((result) => (
                        <option key={result.scenarioId} value={result.scenarioId}>
                            {result.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="pm-stress-metrics" aria-label="Stress test result">
                <MetricStack
                    label="Portfolio drawdown"
                    value={formatPctSigned(selected.portfolioImpactPct)}
                    sub={formatCurrencyOptional(selected.totalImpactUsd)}
                />
                <MetricStack
                    label="Projected value"
                    value={formatCurrencyOptional(selected.projectedPortfolioValueUsd) ?? "$0"}
                    sub={selected.description}
                />
            </div>

            <p className="pm-stress-assumption">{selected.assumption}</p>

            <div className="pm-stress-contributors" role="list" aria-label="Stress test top contributors">
                {selected.contributors.slice(0, 3).map((contributor) => (
                    <div
                        key={`${selected.scenarioId}-${contributor.symbol}`}
                        className="pm-stress-contributor"
                        role="listitem"
                    >
                        <span>{contributor.symbol}</span>
                        <strong>{formatCurrencyOptional(contributor.impactUsd)}</strong>
                        <span>{contributor.effectiveShockPct.toFixed(1)}%</span>
                    </div>
                ))}
            </div>

            {selected.policyBreaches.length > 0 && (
                <p className="pm-stress-assumption">
                    Post-scenario breach: {selected.policyBreaches[0].label} ({selected.policyBreaches[0].value}).
                </p>
            )}
            {selected.missingDataNotes.length > 0 && (
                <p className="pm-stress-assumption">{selected.missingDataNotes[0]}</p>
            )}
        </section>
    );
}

function EmployerStockPlanTaskCard({
    summary,
}: {
    summary: EmployerStockDeRiskingSummary;
}) {
    const action = summary.nextAction;
    if (!action) return null;

    return (
        <article
            className="pm-sell-task pm-employer-plan-task"
            data-testid="employer-stock-plan-task"
            data-state={summary.plan.state}
            data-status={summary.status}
        >
            <header className="pm-sell-task-head">
                <span className="pm-sell-task-kicker">
                    {summary.plan.symbols.join(" / ")}
                </span>
                <span className="pm-risk-policy-status" data-status={summary.status}>
                    {action.overdue ? "Due" : "Scheduled"}
                </span>
            </header>
            <h4 className="pm-sell-task-title">{action.label}</h4>
            <p className="pm-sell-task-message">
                {action.detail} Due {formatDate(action.dueDate)}.
            </p>
            <p className="pm-sell-task-message">
                Current {summary.currentAllocationPct.toFixed(1)}% / target {summary.plan.targetAllocationPct}%.
            </p>
            <nav className="pm-sell-task-links" aria-label={`${action.label} links`}>
                <PolicyLink href={action.href} label="Edit plan" />
                <PolicyLink href="/execution" label="Plan trade" />
            </nav>
        </article>
    );
}

function SellDisciplineTaskCard({ task }: { task: SellDisciplineTask }) {
    const action = SELL_DISCIPLINE_ACTION_LABELS[task.action];
    return (
        <article
            className="pm-sell-task"
            data-testid="sell-discipline-task"
            data-rule-type={task.ruleType}
            data-state={task.state}
        >
            <header className="pm-sell-task-head">
                <span className="pm-sell-task-kicker">{task.symbol ?? "Portfolio"}</span>
                <span className="pm-risk-policy-status" data-status="breached">
                    {action}
                </span>
            </header>
            <h4 className="pm-sell-task-title">{task.label}</h4>
            <p className="pm-sell-task-message">{task.message}</p>
            <nav className="pm-sell-task-links" aria-label={`${task.label} links`}>
                <PolicyLink href={task.href} label="Open source" />
                <PolicyLink href="/execution" label="Plan trade" />
                <PolicyLink href="/#weekly-review" label="Review log" />
            </nav>
        </article>
    );
}

function RiskPolicyDimensionRow({ dimension }: { dimension: RiskPolicyDimension }) {
    return (
        <article
            className="pm-risk-policy-row"
            data-testid="risk-policy-dimension"
            data-policy-id={dimension.id}
            data-status={dimension.status}
            role="listitem"
        >
            <div className="pm-risk-policy-row-main">
                <div className="pm-risk-policy-row-titleline">
                    <h4 className="pm-risk-policy-row-title">{dimension.label}</h4>
                    <span className="pm-risk-policy-status" data-status={dimension.status}>
                        {STATUS_LABELS[dimension.status]}
                    </span>
                </div>
                <p className="pm-risk-policy-explanation">{dimension.explanation}</p>
                {dimension.impactedSymbols.length > 0 && (
                    <p className="pm-risk-policy-symbols">
                        {dimension.impactedSymbols.slice(0, 4).join(" · ")}
                    </p>
                )}
            </div>

            <div className="pm-risk-policy-values">
                <MetricStack
                    label="Current"
                    value={formatCurrent(dimension)}
                    sub={formatCurrencyOptional(dimension.currentValueUsd)}
                />
                <MetricStack
                    label="Target"
                    value={dimension.targetLabel}
                    sub={formatOverage(dimension)}
                />
            </div>
        </article>
    );
}

function RiskPolicyAction({ action }: { action: RiskPolicyNextAction }) {
    return (
        <Link
            href={action.href}
            className="pm-risk-policy-action"
            data-status={action.status}
            data-testid="risk-policy-action"
        >
            <span>
                <span className="pm-risk-policy-action-label">{action.label}</span>
                <span className="pm-risk-policy-action-detail">{action.detail}</span>
            </span>
            <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
    );
}

function PolicyLink({ href, label }: { href: string; label: string }) {
    return (
        <Link href={href} className="pm-risk-policy-link" data-testid="risk-policy-deep-link">
            {label}
            <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
    );
}

function StatusCount({
    label,
    value,
    status,
}: {
    label: string;
    value: number;
    status: RiskPolicyDimensionStatus;
}) {
    return (
        <div className="pm-risk-policy-count" data-status={status}>
            <span className="pm-risk-policy-count-value">{value}</span>
            <span className="pm-risk-policy-count-label">{label}</span>
        </div>
    );
}

function MetricStack({
    label,
    value,
    sub,
}: {
    label: string;
    value: string;
    sub?: string;
}) {
    return (
        <div className="pm-risk-policy-metric">
            <span className="pm-risk-policy-metric-label">{label}</span>
            <span className="pm-risk-policy-metric-value">{value}</span>
            {sub && <span className="pm-risk-policy-metric-sub">{sub}</span>}
        </div>
    );
}

function buildHeadline(summary: RiskPolicyDashboardSummary): string {
    if (summary.overallStatus === "inside") {
        return `${summary.dimensions.length} policy checks are inside the current bands.`;
    }

    const parts = [
        summary.statusCounts.breached > 0
            ? `${summary.statusCounts.breached} breached`
            : null,
        summary.statusCounts.watch > 0
            ? `${summary.statusCounts.watch} watch`
            : null,
        summary.statusCounts.missing_data > 0
            ? `${summary.statusCounts.missing_data} missing data`
            : null,
    ].filter(Boolean);

    return `${parts.join(" · ")} across ${formatCurrencyOptional(summary.totalMarketValue)} connected value.`;
}

function formatCurrent(dimension: RiskPolicyDimension): string {
    if (dimension.currentLabel) return dimension.currentLabel;
    if (dimension.currentPct == null) return "—";
    return `${dimension.currentPct.toFixed(1)}%`;
}

function formatPctSigned(value: number): string {
    if (!Number.isFinite(value)) return "0.0%";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
}

function formatCurrencyOptional(value: number | undefined): string | undefined {
    if (value == null || !Number.isFinite(value)) return undefined;
    const sign = value < 0 ? "-" : "";
    return `${sign}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
}

function formatOverage(dimension: RiskPolicyDimension): string | undefined {
    if (dimension.overLimitUsd > 0 && dimension.overLimitPct > 0) {
        return `${dimension.overLimitPct.toFixed(1)} pts / ${formatCurrencyOptional(dimension.overLimitUsd)} over`;
    }
    if (dimension.status === "missing_data") return dimension.nextAction;
    return undefined;
}

function formatDate(value: string): string {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
}
