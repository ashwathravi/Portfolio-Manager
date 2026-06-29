"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Activity, AlertCircle, CalendarClock, ExternalLink, RefreshCw, Search } from "lucide-react";
import {
    useAlphaRadarChangesQuery,
    useAlphaRadarFilersQuery,
    useAlphaRadarMemorySearchQuery,
    useAlphaRadarReportsQuery,
    useRefreshAlphaRadarFilerMutation,
} from "@/lib/api/alpha-radar/queries";
import { useAlphaRadarAlertEngine } from "@/lib/alerts/useAlphaRadarAlertEngine";
import {
    buildAlphaRadarReportMemoryChunks,
    searchAlphaRadarSemanticChunks,
} from "@/lib/alpha-radar/memory";
import {
    buildAlphaRadarCloneGraph,
    filterAlphaRadarCloneClusters,
    type AlphaRadarCloneCluster,
    type AlphaRadarCloneGraph,
} from "@/lib/alpha-radar/clone-graph";
import {
    scoreAlphaRadarConviction,
    type AlphaRadarConvictionItem,
} from "@/lib/alpha-radar/conviction";
import {
    attachAlphaRadarOverlaysToIdeas,
    filterAlphaRadarOverlayIdeas,
    getAlphaRadarOverlayFilters,
    type AlphaRadarOverlayFilter,
    type AlphaRadarOverlayIdea,
} from "@/lib/alpha-radar/overlays";
import {
    generateAlphaRadarThesisDrafts,
    type AlphaRadarGeneratedThesisDraft,
} from "@/lib/alpha-radar/thesis-drafts";
import {
    createDefaultAlphaRadarSchedules,
    planAlphaRadarScheduledRuns,
    type AlphaRadarScheduledRunRecord,
    type AlphaRadarSchedulerPlan,
} from "@/lib/alpha-radar/scheduler";
import {
    buildAlphaRadarBacktestSignals,
    runAlphaRadarBacktest,
    type AlphaRadarBacktestResult,
    type AlphaRadarBacktestScenario,
} from "@/lib/alpha-radar/backtest";
import {
    createDefaultAlphaRadarProviderBudgets,
    evaluateAlphaRadarProviderBudget,
    planAlphaRadarMaintenanceAction,
    summarizeAlphaRadarOperationalHealth,
    type AlphaRadarMaintenancePlan,
    type AlphaRadarOperationalEvent,
    type AlphaRadarOperationalHealthSummary,
    type AlphaRadarProviderBudgetDecision,
    type AlphaRadarProviderKey,
    type AlphaRadarProviderUsage,
} from "@/lib/alpha-radar/operations";
import type {
    AlphaRadarExternalOverlay,
    AlphaRadarMemoChange,
    AlphaRadarReportRecord,
    AlphaRadarTrackedFilerRecord,
} from "@/lib/alpha-radar";
import type { AlphaRadarSemanticSearchResult } from "@/lib/alpha-radar/agent-contracts";

type AlphaRadarDraftReviewState = "needs-review" | "editing" | "accepted" | "archived";
const ALPHA_RADAR_HELP_HREF = "/help#alpha-radar-v2";

export interface AlphaRadarResearchData {
    filers: AlphaRadarTrackedFilerRecord[];
    selectedFilerId: string | null;
    setSelectedFilerId: (id: string) => void;
    isLoading: boolean;
    isFallback: boolean;
    errorMessage?: string;
}

export function useAlphaRadarResearchData(): AlphaRadarResearchData {
    const filersQuery = useAlphaRadarFilersQuery({
        retry: false,
        refetchOnWindowFocus: false,
    });
    const liveFilers = filersQuery.data ?? [];
    const filers = liveFilers.length > 0 ? liveFilers : FALLBACK_FILERS;
    const [requestedFilerId, setRequestedFilerId] = useState<string | null>(null);
    const selectedFilerId = requestedFilerId && filers.some((filer) => filer.id === requestedFilerId)
        ? requestedFilerId
        : filers[0]?.id ?? null;

    return {
        filers,
        selectedFilerId,
        setSelectedFilerId: setRequestedFilerId,
        isLoading: filersQuery.isLoading,
        isFallback: liveFilers.length === 0,
        errorMessage: filersQuery.error?.message,
    };
}

export function AlphaRadarFilerColumn({
    data,
    query,
}: {
    data: AlphaRadarResearchData;
    query: string;
}) {
    const filtered = useMemo(
        () => data.filers.filter((filer) => matchQuery(query, filer.name, filer.managerName ?? undefined, filer.fundStyle ?? undefined)),
        [data.filers, query],
    );

    if (data.isLoading && filtered.length === 0) {
        return <div className="pm-research-empty-hint" data-testid="alpha-radar-loading">Loading tracked filers.</div>;
    }

    if (filtered.length === 0) {
        return <div className="pm-research-empty-hint" data-testid="alpha-radar-empty">No tracked filers match.</div>;
    }

    return (
        <>
            {filtered.map((filer) => (
                <button
                    key={filer.id}
                    type="button"
                    className={`pm-alpha-filer-card${data.selectedFilerId === filer.id ? " is-selected" : ""}`}
                    onClick={() => data.setSelectedFilerId(filer.id)}
                    data-testid="alpha-radar-filer"
                >
                    <span className="pm-alpha-filer-head">
                        <span>
                            <span className="pm-alpha-filer-name">{filer.name}</span>
                            <span className="pm-alpha-filer-style">{filer.fundStyle ?? "13F manager"}</span>
                        </span>
                        <span className={`pm-alpha-health${filer.enabled ? " is-on" : ""}`}>
                            {filer.enabled ? "Tracking" : "Paused"}
                        </span>
                    </span>
                    <span className="pm-alpha-filer-meta">
                        <span>CIK {filer.cik}</span>
                        <span>{filer.managerName ?? "Manager watch"}</span>
                    </span>
                </button>
            ))}
        </>
    );
}

export function AlphaRadarDetailPane({
    data,
}: {
    data: AlphaRadarResearchData;
}) {
    const [memoryQuery, setMemoryQuery] = useState("");
    const [cloneStyleFilter, setCloneStyleFilter] = useState<string>("all");
    const [overlayFilter, setOverlayFilter] = useState<AlphaRadarOverlayFilter>("all");
    const [draftReviewStates, setDraftReviewStates] = useState<Record<string, AlphaRadarDraftReviewState>>({});
    const [draftHypothesisEdits, setDraftHypothesisEdits] = useState<Record<string, string>>({});
    const selectedFiler = data.filers.find((filer) => filer.id === data.selectedFilerId) ?? data.filers[0];
    const reportsQuery = useAlphaRadarReportsQuery(
        { trackedFilerId: selectedFiler?.id },
        { enabled: Boolean(selectedFiler), retry: false, refetchOnWindowFocus: false },
    );
    const changesQuery = useAlphaRadarChangesQuery(
        selectedFiler?.id ?? "",
        undefined,
        { enabled: Boolean(selectedFiler), retry: false, refetchOnWindowFocus: false },
    );
    const refresh = useRefreshAlphaRadarFilerMutation(selectedFiler?.id ?? "");
    const reports = reportsQuery.data && reportsQuery.data.length > 0
        ? reportsQuery.data
        : fallbackReportsFor(selectedFiler?.id);
    const report = reports[0];
    const changes = changesQuery.data && changesQuery.data.length > 0
        ? changesQuery.data
        : fallbackChangesFor(selectedFiler?.id);
    useAlphaRadarAlertEngine({
        changes,
        reports,
        filers: data.filers,
    });
    const materialChanges = changes.filter((change) => change.changeType !== "unchanged");
    const overlapCount = changes.filter((change) => change.userRelevance.reasons.length > 0).length;
    const usesFallback = data.isFallback || !reportsQuery.data?.length || !changesQuery.data?.length;
    const memoryChunks = reports.flatMap((item) => buildAlphaRadarReportMemoryChunks({ report: item, filer: selectedFiler }));
    const localMemorySearch = searchAlphaRadarSemanticChunks({
        query: memoryQuery,
        chunks: memoryChunks,
        limit: 4,
    });
    const liveMemorySearch = useAlphaRadarMemorySearchQuery(
        {
            query: memoryQuery,
            trackedFilerId: selectedFiler?.id,
            reportPeriod: report?.reportPeriod,
            limit: 4,
        },
        {
            enabled: memoryQuery.trim().length > 1,
            retry: false,
            refetchOnWindowFocus: false,
        },
    );
    const memorySearch = liveMemorySearch.data?.matches.length
        ? liveMemorySearch.data
        : localMemorySearch;
    const cloneGraph = buildAlphaRadarCloneGraph({
        filers: data.filers,
        changes: usesFallback ? FALLBACK_CHANGES : changes,
        reportPeriod: report?.reportPeriod,
        userPortfolioTickers: ["AAPL", "MSFT"],
        userWatchlistTickers: ["CB", "NVDA", "PG"],
        userThesisTickers: ["AAPL", "NVDA"],
    });
    const cloneFundStyles = ["all", ...new Set(cloneGraph.clusters.flatMap((cluster) => cluster.fundStyles))];
    const cloneClusters = filterAlphaRadarCloneClusters(cloneGraph.clusters, cloneStyleFilter);
    const convictionItems = scoreAlphaRadarConviction({
        changes: usesFallback ? FALLBACK_CHANGES : changes,
        cloneClusters: cloneGraph.clusters,
        semanticContext: memorySearch.matches,
        reportPeriod: report?.reportPeriod,
    });
    const overlayIdeas = attachAlphaRadarOverlaysToIdeas({
        changes: usesFallback ? FALLBACK_CHANGES : changes,
        overlays: usesFallback ? FALLBACK_EXTERNAL_OVERLAYS : [],
    });
    const overlayFilters = getAlphaRadarOverlayFilters(overlayIdeas);
    const filteredOverlayIdeas = filterAlphaRadarOverlayIdeas(overlayIdeas, overlayFilter);
    const thesisDrafts = generateAlphaRadarThesisDrafts({
        changes: usesFallback ? FALLBACK_CHANGES : changes,
        convictionItems,
        reportPeriod: report?.reportPeriod ?? "latest",
        sourceFilingIds: report?.sourceFilingIds ?? [],
        semanticContext: memorySearch.matches,
        externalOverlays: usesFallback ? FALLBACK_EXTERNAL_OVERLAYS : [],
        existingThesisTickers: ["AAPL", "NVDA"],
        sourceReportId: report?.id,
        limit: 3,
    });
    const schedulerPlan = planAlphaRadarScheduledRuns({
        schedules: createDefaultAlphaRadarSchedules({
            kind: "tracked-filer",
            trackedFilerId: selectedFiler?.id ?? "unknown",
            cik: selectedFiler?.cik,
            slug: selectedFiler?.slug,
        }),
        runHistory: FALLBACK_SCHEDULE_RUNS,
    });
    const providerDecisions = createDefaultAlphaRadarProviderBudgets({
        target: "local",
        now: "2026-05-13T00:00:00.000Z",
    }).map((budget) => evaluateAlphaRadarProviderBudget({
        budget,
        usage: FALLBACK_PROVIDER_USAGE[budget.provider],
        now: "2026-05-13T16:00:00.000Z",
    }));
    const operationsHealth = summarizeAlphaRadarOperationalHealth({
        generatedAt: "2026-05-13T16:00:00.000Z",
        scheduledRuns: [...FALLBACK_SCHEDULE_RUNS, ...schedulerPlan.dueRuns],
        providerDecisions,
        events: FALLBACK_OPERATION_EVENTS,
    });
    const maintenancePlan = planAlphaRadarMaintenanceAction({
        action: "reprocess-filer-period",
        scope: {
            kind: "tracked-filer",
            trackedFilerId: selectedFiler?.id ?? "unknown",
            cik: selectedFiler?.cik,
            slug: selectedFiler?.slug,
        },
        reportPeriod: report?.reportPeriod,
        requestedBy: "research-ui",
        reason: "Operator dry-run from Alpha Radar run operations.",
    });
    const backtestResult = runAlphaRadarBacktest({
        signals: buildAlphaRadarBacktestSignals({
            changes: usesFallback ? FALLBACK_CHANGES : changes,
            convictionItems,
            cloneClusters: cloneGraph.clusters,
            reportPeriodEndByPeriod: FALLBACK_REPORT_PERIOD_END_BY_PERIOD,
            filingAcceptedAtByFilingId: FALLBACK_FILING_ACCEPTED_AT_BY_ID,
        }),
        pricesByTicker: FALLBACK_BACKTEST_PRICES,
        benchmarkPrices: FALLBACK_BENCHMARK_PRICES,
        benchmarkTicker: "SPY",
        forwardWindowsDays: [90],
        generatedAt: "2026-05-13T00:00:00.000Z",
    });

    if (!selectedFiler) {
        return (
            <div className="pm-research-empty" data-testid="alpha-radar-detail-empty">
                <h2 className="pm-card-title">Alpha Radar</h2>
                <p className="pm-card-subtitle">No tracked filers are available.</p>
            </div>
        );
    }

    return (
        <div className="pm-alpha-detail" data-testid="alpha-radar-detail">
            <header className="pm-research-pane-head">
                <div>
                    <div className="pm-alpha-eyebrow">Alpha Radar</div>
                    <h2 className="pm-card-title">{selectedFiler.name}</h2>
                    <p className="pm-card-subtitle">
                        {report?.reportPeriod ?? "Latest quarter"} · {selectedFiler.fundStyle ?? "13F manager"}
                    </p>
                </div>
                <button
                    type="button"
                    className="pm-btn pm-btn-secondary"
                    onClick={() => refresh.mutate({ force: true })}
                    disabled={refresh.isPending}
                    data-testid="alpha-radar-refresh"
                >
                    <RefreshCw size={14} aria-hidden="true" />
                    <span>{refresh.isPending ? "Refreshing" : "Refresh"}</span>
                </button>
                <Link href={ALPHA_RADAR_HELP_HREF} className="pm-btn pm-btn-secondary" data-testid="alpha-radar-help-link">
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>Guide</span>
                </Link>
            </header>

            {(usesFallback || data.errorMessage || reportsQuery.error || changesQuery.error) && (
                <div className="pm-alpha-status" data-testid="alpha-radar-fallback">
                    <AlertCircle size={14} aria-hidden="true" />
                    <span>
                        Showing seeded Alpha Radar data until the live 13F refresh pipeline has local database and SEC access.{" "}
                        <Link href="/help#alpha-radar-v1">Read setup notes</Link>
                    </span>
                </div>
            )}

            <AlphaRadarSchedulerPanel plan={schedulerPlan} />

            <AlphaRadarOperationsPanel
                health={operationsHealth}
                providerDecisions={providerDecisions}
                maintenancePlan={maintenancePlan}
            />

            <AlphaRadarBacktestPanel result={backtestResult} />

            <div className="pm-alpha-stat-grid" data-testid="alpha-radar-stats">
                <AlphaRadarStat label="Material changes" value={materialChanges.length.toString()} />
                <AlphaRadarStat label="Overlap" value={overlapCount.toString()} />
                <AlphaRadarStat label="Source filings" value={(report?.sourceFilingIds.length ?? 0).toString()} />
            </div>

            {report && (
                <section className="pm-alpha-report" data-testid="alpha-radar-report">
                    <div className="pm-alpha-report-head">
                        <div>
                            <h3>{report.title}</h3>
                            <p>{report.summary}</p>
                        </div>
                        <a href="/research" className="pm-card-link">
                            Link context <ExternalLink size={12} aria-hidden="true" />
                        </a>
                    </div>
                    <div className="pm-alpha-section-grid">
                        {report.sections.slice(1, 6).map((section) => (
                            <article key={section.id} className="pm-alpha-section" data-kind={section.kind}>
                                <span className="pm-alpha-section-title">{section.title}</span>
                                <p>{stripMarkdownList(section.markdown)}</p>
                            </article>
                        ))}
                    </div>
                </section>
            )}

            <section className="pm-alpha-changes" aria-label="Material 13F changes">
                <h3 className="pm-alpha-subhead">Material 13F changes</h3>
                <div className="pm-alpha-change-list">
                    {materialChanges.slice(0, 6).map((change) => (
                        <AlphaRadarChangeRow key={alphaRadarChangeKey(change)} change={change} />
                    ))}
                </div>
            </section>

            <AlphaRadarCloneGraphPanel
                graph={cloneGraph}
                clusters={cloneClusters}
                fundStyles={cloneFundStyles}
                selectedFundStyle={cloneStyleFilter}
                onFundStyleChange={setCloneStyleFilter}
            />

            <AlphaRadarConvictionPanel items={convictionItems} />

            <AlphaRadarOverlayPanel
                ideas={filteredOverlayIdeas}
                filters={overlayFilters}
                selectedFilter={overlayFilter}
                onFilterChange={setOverlayFilter}
            />

            <AlphaRadarThesisDraftPanel
                drafts={thesisDrafts}
                reviewStates={draftReviewStates}
                hypothesisEdits={draftHypothesisEdits}
                onEdit={(draft) => {
                    setDraftReviewStates((current) => ({ ...current, [draft.id ?? draft.title]: "editing" }));
                    setDraftHypothesisEdits((current) => ({
                        ...current,
                        [draft.id ?? draft.title]: current[draft.id ?? draft.title] ?? draft.hypothesis,
                    }));
                }}
                onHypothesisChange={(draft, value) => {
                    setDraftHypothesisEdits((current) => ({ ...current, [draft.id ?? draft.title]: value }));
                }}
                onSave={(draft) => {
                    setDraftReviewStates((current) => ({ ...current, [draft.id ?? draft.title]: "needs-review" }));
                }}
                onAccept={(draft) => {
                    setDraftReviewStates((current) => ({ ...current, [draft.id ?? draft.title]: "accepted" }));
                }}
                onArchive={(draft) => {
                    setDraftReviewStates((current) => ({ ...current, [draft.id ?? draft.title]: "archived" }));
                }}
            />

            <AlphaRadarMemorySearch
                query={memoryQuery}
                onQueryChange={setMemoryQuery}
                search={memorySearch}
                isFallback={Boolean(memoryQuery.trim()) && (!liveMemorySearch.data?.matches.length || Boolean(liveMemorySearch.error))}
            />
        </div>
    );
}

function AlphaRadarBacktestPanel({ result }: { result: AlphaRadarBacktestResult }) {
    const completed = result.trades.length;
    const hitRate = completed > 0
        ? result.trades.filter((trade) => trade.hit).length / completed
        : 0;
    const averageRelative = completed > 0
        ? result.trades.reduce((sum, trade) => sum + trade.relativeReturn, 0) / completed
        : 0;
    const averageLag = completed > 0
        ? result.trades.reduce((sum, trade) => sum + trade.lagDays, 0) / completed
        : 0;

    return (
        <section className="pm-alpha-backtest" aria-label="Alpha Radar exploratory backtest" data-testid="alpha-radar-backtest">
            <div className="pm-alpha-report-head">
                <div>
                    <h3 className="pm-alpha-subhead">Exploratory backtest</h3>
                    <p className="pm-card-subtitle">
                        Delay-adjusted 13F signal quality, not production trading recommendations.
                    </p>
                </div>
                <span className="pm-alpha-scheduler-badge">{result.benchmarkTicker} benchmark</span>
            </div>
            <div className="pm-alpha-backtest-grid">
                <AlphaRadarStat label="Completed" value={completed.toString()} />
                <AlphaRadarStat label="Hit rate" value={formatBacktestPct(hitRate)} />
                <AlphaRadarStat label="Avg relative" value={formatBacktestPct(averageRelative)} />
                <AlphaRadarStat label="Avg lag" value={`${Math.round(averageLag)}d`} />
            </div>
            <div className="pm-alpha-change-list">
                {result.summaries.slice(0, 4).map((summary) => (
                    <article
                        key={`${summary.scenario}-${summary.windowDays}`}
                        className="pm-alpha-change-row"
                        data-testid="alpha-radar-backtest-summary"
                    >
                        <div>
                            <span className={`pm-alpha-change-type is-${summary.averageRelativeReturn >= 0 ? "pos" : "neg"}`}>
                                {backtestScenarioLabel(summary.scenario)}
                            </span>
                            <h4>{summary.windowDays}-day forward window</h4>
                            <p>
                                Hit rate {formatBacktestPct(summary.hitRate)} · Avg relative {formatBacktestPct(summary.averageRelativeReturn)} · Worst drawdown {formatBacktestPct(summary.worstDrawdown)}
                            </p>
                            <span className="pm-alpha-overlap">Lag-aware entry: {Math.round(summary.averageLagDays)} days after quarter end</span>
                        </div>
                        <strong>{summary.completed}</strong>
                    </article>
                ))}
            </div>
            <p className="pm-card-subtitle">{result.methodologyNote}</p>
        </section>
    );
}

function AlphaRadarOperationsPanel({
    health,
    providerDecisions,
    maintenancePlan,
}: {
    health: AlphaRadarOperationalHealthSummary;
    providerDecisions: AlphaRadarProviderBudgetDecision[];
    maintenancePlan: AlphaRadarMaintenancePlan;
}) {
    const lastRun = health.lastRun;
    const primaryRetry = health.retryActions[0];

    return (
        <section className="pm-alpha-operations" aria-label="Alpha Radar run operations" data-testid="alpha-radar-operations">
            <div className="pm-alpha-report-head">
                <div>
                    <h3 className="pm-alpha-subhead">Run operations</h3>
                    <p className="pm-card-subtitle">Budgets, failures, retries, and maintenance readiness.</p>
                </div>
                <span className={`pm-alpha-scheduler-badge is-${health.status}`}>
                    <Activity size={13} aria-hidden="true" />
                    {health.status}
                </span>
            </div>
            <div className="pm-alpha-operations-grid">
                <div className="pm-alpha-section">
                    <span className="pm-alpha-section-title">Last run</span>
                    <p>{lastRun ? `${lastRun.label} · ${lastRun.status}` : "No run history."}</p>
                </div>
                <div className="pm-alpha-section">
                    <span className="pm-alpha-section-title">Provider budgets</span>
                    <p>{health.providerStatus.warnedProviders} warned · {health.providerStatus.blockedProviders} blocked</p>
                </div>
                <div className="pm-alpha-section">
                    <span className="pm-alpha-section-title">Retries</span>
                    <p>{primaryRetry ? `${health.retryActions.length} actions · ${primaryRetry.label}` : "No retry actions."}</p>
                </div>
                <div className="pm-alpha-section">
                    <span className="pm-alpha-section-title">Maintenance</span>
                    <p>{maintenancePlan.dryRun ? "Dry-run ready" : maintenancePlan.status} · {maintenancePlan.steps.length} steps</p>
                </div>
            </div>
            <div className="pm-alpha-change-list">
                {providerDecisions.slice(0, 3).map((decision) => (
                    <article
                        key={decision.provider}
                        className="pm-alpha-change-row"
                        data-status={decision.status}
                        data-testid="alpha-radar-provider-budget"
                    >
                        <div>
                            <span className={`pm-alpha-change-type is-${decision.status === "allowed" ? "pos" : decision.status === "warn" ? "neutral" : "neg"}`}>
                                {decision.status}
                            </span>
                            <h4>{decision.label}</h4>
                            <p>{decision.reasons[0]}</p>
                            <span className="pm-alpha-overlap">
                                Resets {formatIsoDate(decision.resetAt)} · {decision.window} budget
                            </span>
                        </div>
                        <strong>{decision.remaining}</strong>
                    </article>
                ))}
            </div>
            <p className="pm-card-subtitle">{health.actionableItems[0]}</p>
        </section>
    );
}

function AlphaRadarSchedulerPanel({ plan }: { plan: AlphaRadarSchedulerPlan }) {
    const lastRun = plan.summary.lastRun;
    const nextQueuedRun = plan.dueRuns[0];

    return (
        <section className="pm-alpha-scheduler" aria-label="Alpha Radar scheduled orchestration" data-testid="alpha-radar-scheduler">
            <div className="pm-alpha-report-head">
                <div>
                    <h3 className="pm-alpha-subhead">Scheduled orchestration</h3>
                    <p className="pm-card-subtitle">
                        Weekly and quarterly refreshes use deterministic job keys with in-app delivery.
                    </p>
                </div>
                <span className="pm-alpha-scheduler-badge">
                    <CalendarClock size={13} aria-hidden="true" />
                    {plan.result.enqueuedJobs.length} queued
                </span>
            </div>
            <div className="pm-alpha-scheduler-grid">
                <div className="pm-alpha-section">
                    <span className="pm-alpha-section-title">Next window</span>
                    <p>{nextQueuedRun ? `${nextQueuedRun.scheduleName} · ${nextQueuedRun.windowKey}` : "No run due in this window."}</p>
                </div>
                <div className="pm-alpha-section">
                    <span className="pm-alpha-section-title">Last run</span>
                    <p>{lastRun ? `${lastRun.scheduleName} · ${lastRun.status}` : "No scheduled run history yet."}</p>
                </div>
                <div className="pm-alpha-section">
                    <span className="pm-alpha-section-title">Delivery</span>
                    <p>In-app delivery is approved; Email, Slack, and Telegram remain adapter-gated.</p>
                </div>
                <div className="pm-alpha-section">
                    <span className="pm-alpha-section-title">Status</span>
                    <p>{plan.summary.actionableStatus}</p>
                </div>
            </div>
        </section>
    );
}

function backtestScenarioLabel(scenario: AlphaRadarBacktestScenario): string {
    switch (scenario) {
        case "top-adds":
            return "Top adds";
        case "exits":
            return "Exits";
        case "consensus":
            return "Consensus";
        case "conviction":
            return "Conviction";
        case "user-overlap":
            return "User overlap";
    }
}

function formatBacktestPct(value: number): string {
    const pct = value * 100;
    const sign = pct > 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
}

function formatIsoDate(value: string): string {
    return value.slice(0, 10);
}

function AlphaRadarOverlayPanel({
    ideas,
    filters,
    selectedFilter,
    onFilterChange,
}: {
    ideas: AlphaRadarOverlayIdea[];
    filters: AlphaRadarOverlayFilter[];
    selectedFilter: AlphaRadarOverlayFilter;
    onFilterChange: (filter: AlphaRadarOverlayFilter) => void;
}) {
    return (
        <section className="pm-alpha-overlays" aria-label="External research overlays" data-testid="alpha-radar-overlays">
            <div className="pm-alpha-report-head">
                <div>
                    <h3 className="pm-alpha-subhead">External overlays</h3>
                    <p className="pm-card-subtitle">Provider-cited context, separate from source 13F facts.</p>
                </div>
            </div>
            {filters.length > 1 && (
                <div className="pm-alpha-filter-row" role="group" aria-label="Overlay filter">
                    {filters.map((filter) => (
                        <button
                            key={filter}
                            type="button"
                            className={`pm-alpha-filter-chip${selectedFilter === filter ? " is-active" : ""}`}
                            onClick={() => onFilterChange(filter)}
                            data-testid="alpha-radar-overlay-filter"
                        >
                            {overlayFilterLabel(filter)}
                        </button>
                    ))}
                </div>
            )}
            <div className="pm-alpha-change-list">
                {ideas.length > 0 ? ideas.slice(0, 5).map((idea) => (
                    <article key={alphaRadarChangeKey(idea.change)} className="pm-alpha-change-row" data-testid="alpha-radar-overlay-idea">
                        <div>
                            <span className="pm-alpha-change-type is-neutral">
                                {idea.overlays.map((overlay) => overlayKindLabel(overlay.kind)).join(" · ")}
                            </span>
                            <h4>{idea.change.ticker ? `${idea.change.issuerName} (${idea.change.ticker})` : idea.change.issuerName}</h4>
                            <p>{idea.overlays[0].summary}</p>
                            <span className="pm-alpha-overlap">
                                {idea.overlays[0].provider} · {idea.overlays[0].evidence[0].title}
                            </span>
                        </div>
                        <strong>{idea.overlays.length}</strong>
                    </article>
                )) : (
                    <div className="pm-research-empty-hint" data-testid="alpha-radar-overlays-empty">
                        No external overlays match this filter.
                    </div>
                )}
            </div>
        </section>
    );
}

function AlphaRadarConvictionPanel({ items }: { items: AlphaRadarConvictionItem[] }) {
    return (
        <section className="pm-alpha-conviction" aria-label="Alpha Radar conviction ranking" data-testid="alpha-radar-conviction-ranking">
            <div className="pm-alpha-report-head">
                <div>
                    <h3 className="pm-alpha-subhead">Conviction ranking</h3>
                    <p className="pm-card-subtitle">
                        Raw 13F signal, user relevance, and evidence fit scored separately.
                    </p>
                </div>
            </div>
            <div className="pm-alpha-change-list">
                {items.length > 0 ? items.slice(0, 5).map((item) => (
                    <article
                        key={item.id}
                        className="pm-alpha-change-row"
                        data-trend={item.trend}
                        data-testid="alpha-radar-conviction-row"
                    >
                        <div>
                            <span className={`pm-alpha-change-type is-${item.changeType === "exited" || item.changeType === "decreased" ? "neg" : "pos"}`}>
                                #{item.rank} {item.trend}
                            </span>
                            <h4>{item.ticker ? `${item.issuerName} (${item.ticker})` : item.issuerName}</h4>
                            <p>{item.factors.slice(0, 3).map((factor) => factor.label).join(" · ")}</p>
                            <span className="pm-alpha-overlap" data-testid="alpha-radar-conviction-components">
                                Raw {item.rawSignalScore} · User {item.userRelevanceScore} · Evidence {item.evidenceFitScore}
                            </span>
                        </div>
                        <strong>{item.convictionScore}</strong>
                    </article>
                )) : (
                    <div className="pm-research-empty-hint" data-testid="alpha-radar-conviction-empty">
                        No conviction scores are available for this report.
                    </div>
                )}
            </div>
        </section>
    );
}

function AlphaRadarThesisDraftPanel({
    drafts,
    reviewStates,
    hypothesisEdits,
    onEdit,
    onHypothesisChange,
    onSave,
    onAccept,
    onArchive,
}: {
    drafts: AlphaRadarGeneratedThesisDraft[];
    reviewStates: Record<string, AlphaRadarDraftReviewState>;
    hypothesisEdits: Record<string, string>;
    onEdit: (draft: AlphaRadarGeneratedThesisDraft) => void;
    onHypothesisChange: (draft: AlphaRadarGeneratedThesisDraft, value: string) => void;
    onSave: (draft: AlphaRadarGeneratedThesisDraft) => void;
    onAccept: (draft: AlphaRadarGeneratedThesisDraft) => void;
    onArchive: (draft: AlphaRadarGeneratedThesisDraft) => void;
}) {
    return (
        <section className="pm-alpha-thesis-drafts" aria-label="Alpha Radar thesis drafts" data-testid="alpha-radar-thesis-drafts">
            <div className="pm-alpha-report-head">
                <div>
                    <h3 className="pm-alpha-subhead">Thesis drafts</h3>
                    <p className="pm-card-subtitle">Review-gated “why now?” candidates with citations.</p>
                </div>
            </div>
            <div className="pm-alpha-change-list">
                {drafts.length > 0 ? drafts.map((draft) => {
                    const key = draft.id ?? draft.title;
                    const state = reviewStates[key] ?? draft.reviewStatus;
                    const hypothesis = hypothesisEdits[key] ?? draft.hypothesis;
                    return (
                        <article key={key} className="pm-alpha-change-row" data-status={state} data-testid="alpha-radar-thesis-draft">
                            <div>
                                <span className={`pm-alpha-change-type is-${state === "archived" ? "neutral" : state === "accepted" ? "pos" : "neutral"}`}>
                                    {state.replace("-", " ")} · {draft.confidence}
                                </span>
                                <h4>{draft.title}</h4>
                                {state === "editing" ? (
                                    <textarea
                                        className="pm-alpha-draft-edit"
                                        value={hypothesis}
                                        onChange={(event) => onHypothesisChange(draft, event.target.value)}
                                        aria-label={`Edit thesis draft for ${draft.ticker ?? draft.issuerName}`}
                                        data-testid="alpha-radar-thesis-edit-field"
                                    />
                                ) : (
                                    <p>{hypothesis}</p>
                                )}
                                <span className="pm-alpha-overlap">
                                    {draft.supportingEvidence.length} citations · {draft.duplicateOfExistingThesis ? "existing thesis match" : "new candidate"}
                                </span>
                                <div className="pm-alpha-draft-actions">
                                    {state === "editing" ? (
                                        <button type="button" className="pm-btn pm-btn-secondary" onClick={() => onSave(draft)} data-testid="alpha-radar-thesis-save">
                                            Save
                                        </button>
                                    ) : (
                                        <button type="button" className="pm-btn pm-btn-secondary" onClick={() => onEdit(draft)} data-testid="alpha-radar-thesis-edit">
                                            Edit
                                        </button>
                                    )}
                                    <button type="button" className="pm-btn pm-btn-primary" onClick={() => onAccept(draft)} data-testid="alpha-radar-thesis-accept">
                                        Accept
                                    </button>
                                    <button type="button" className="pm-btn pm-btn-secondary" onClick={() => onArchive(draft)} data-testid="alpha-radar-thesis-archive">
                                        Archive
                                    </button>
                                </div>
                            </div>
                            <strong>{draft.supportingEvidence.length}</strong>
                        </article>
                    );
                }) : (
                    <div className="pm-research-empty-hint" data-testid="alpha-radar-thesis-drafts-empty">
                        No thesis drafts meet the conviction threshold for this report.
                    </div>
                )}
            </div>
        </section>
    );
}

function overlayFilterLabel(filter: AlphaRadarOverlayFilter): string {
    if (filter === "all") return "All overlays";
    if (filter === "AI infrastructure" || filter === "Insider corroboration") return filter;
    return overlayKindLabel(filter as AlphaRadarExternalOverlay["kind"]);
}

function overlayKindLabel(kind: AlphaRadarExternalOverlay["kind"]): string {
    return kind.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function AlphaRadarStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="pm-alpha-stat">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function AlphaRadarChangeRow({ change }: { change: AlphaRadarMemoChange }) {
    const tone =
        change.changeType === "new" || change.changeType === "increased"
            ? "pos"
            : change.changeType === "exited" || change.changeType === "decreased"
              ? "neg"
              : "neutral";
    return (
        <article
            className="pm-alpha-change-row"
            data-change-type={change.changeType}
            data-testid="alpha-radar-change-row"
        >
            <div>
                <span className={`pm-alpha-change-type is-${tone}`}>{change.changeType}</span>
                <h4>{change.ticker ? `${change.issuerName} (${change.ticker})` : change.issuerName}</h4>
                <p>{change.displayReason}</p>
                {change.userRelevance.reasons.length > 0 && (
                    <span className="pm-alpha-overlap">{change.userRelevance.reasons.join(", ")}</span>
                )}
            </div>
            <strong>{change.materialityScore}</strong>
        </article>
    );
}

function alphaRadarChangeKey(change: AlphaRadarMemoChange): string {
    return change.id ?? `${change.trackedFilerId}-${change.reportPeriod}-${change.cusip}`;
}

function AlphaRadarMemorySearch({
    query,
    onQueryChange,
    search,
    isFallback,
}: {
    query: string;
    onQueryChange: (query: string) => void;
    search: AlphaRadarSemanticSearchResult;
    isFallback: boolean;
}) {
    const hasQuery = query.trim().length > 0;

    return (
        <section className="pm-alpha-memory" aria-label="Alpha Radar evidence memory" data-testid="alpha-radar-memory">
            <h3 className="pm-alpha-subhead">Evidence memory</h3>
            <label className="pm-research-search">
                <Search size={15} aria-hidden="true" />
                <input
                    type="search"
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="Search filer, theme, company, or quarter"
                    aria-label="Search Alpha Radar evidence"
                    data-testid="alpha-radar-memory-search"
                />
            </label>
            {hasQuery && (
                <div className="pm-alpha-section-grid" data-provider={search.provider}>
                    {search.matches.length > 0 ? search.matches.map((match) => (
                        <article key={match.chunkId} className="pm-alpha-section" data-testid="alpha-radar-memory-result">
                            <span className="pm-alpha-section-title">{match.citation.title}</span>
                            <p>{match.text}</p>
                            {match.citation.url && (
                                <a className="pm-card-link" href={match.citation.url}>
                                    Source <ExternalLink size={12} aria-hidden="true" />
                                </a>
                            )}
                        </article>
                    )) : (
                        <div className="pm-research-empty-hint" data-testid="alpha-radar-memory-empty">
                            No Alpha Radar evidence matches this search.
                        </div>
                    )}
                </div>
            )}
            {hasQuery && isFallback && (
                <p className="pm-card-subtitle" data-testid="alpha-radar-memory-fallback">
                    Using local keyword fallback until semantic memory is populated in Postgres.
                </p>
            )}
        </section>
    );
}

function AlphaRadarCloneGraphPanel({
    graph,
    clusters,
    fundStyles,
    selectedFundStyle,
    onFundStyleChange,
}: {
    graph: AlphaRadarCloneGraph;
    clusters: AlphaRadarCloneCluster[];
    fundStyles: string[];
    selectedFundStyle: string;
    onFundStyleChange: (style: string) => void;
}) {
    return (
        <section className="pm-alpha-clone-graph" aria-label="Clone tracking graph" data-testid="alpha-radar-clone-graph">
            <div className="pm-alpha-report-head">
                <div>
                    <h3 className="pm-alpha-subhead">Clone tracking</h3>
                    <p className="pm-card-subtitle">
                        {graph.nodes.length} nodes · {graph.edges.length} links across tracked filer overlap.
                    </p>
                </div>
            </div>
            <div className="pm-alpha-filter-row" role="group" aria-label="Fund style filter">
                {fundStyles.map((style) => (
                    <button
                        key={style}
                        type="button"
                        className={`pm-alpha-filter-chip${selectedFundStyle === style ? " is-active" : ""}`}
                        onClick={() => onFundStyleChange(style)}
                        data-testid="alpha-radar-clone-style"
                    >
                        {style === "all" ? "All styles" : style}
                    </button>
                ))}
            </div>
            <div className="pm-alpha-change-list">
                {clusters.length > 0 ? clusters.slice(0, 5).map((cluster) => (
                    <article
                        key={cluster.id}
                        className="pm-alpha-change-row"
                        data-direction={cluster.direction}
                        data-testid="alpha-radar-clone-cluster"
                    >
                        <div>
                            <span className={`pm-alpha-change-type is-${cluster.direction === "consensus_buy" ? "pos" : cluster.direction === "consensus_sell" ? "neg" : "neutral"}`}>
                                {cluster.direction.replace(/_/g, " ")}
                            </span>
                            <h4>{cluster.ticker ? `${cluster.issuerName} (${cluster.ticker})` : cluster.issuerName}</h4>
                            <p>
                                {cluster.filers.map((filer) => `${filer.name} ${filer.changeType}`).join(" · ")}
                            </p>
                            {cluster.userOverlap.reasons.length > 0 && (
                                <span className="pm-alpha-overlap">{cluster.userOverlap.reasons.join(", ")}</span>
                            )}
                        </div>
                        <strong>{Math.round(cluster.overlapScore)}</strong>
                    </article>
                )) : (
                    <div className="pm-research-empty-hint" data-testid="alpha-radar-clone-empty">
                        No clone overlap matches this fund style.
                    </div>
                )}
            </div>
        </section>
    );
}

function fallbackReportsFor(trackedFilerId: string | undefined): AlphaRadarReportRecord[] {
    return FALLBACK_REPORTS.filter((report) => !trackedFilerId || report.trackedFilerId === trackedFilerId);
}

function fallbackChangesFor(trackedFilerId: string | undefined): AlphaRadarMemoChange[] {
    return FALLBACK_CHANGES.filter((change) => !trackedFilerId || change.trackedFilerId === trackedFilerId);
}

function stripMarkdownList(markdown: string): string {
    return markdown
        .split("\n")
        .map((line) => line.replace(/^[-*]\s+/, "").trim())
        .filter(Boolean)[0] ?? markdown;
}

function matchQuery(q: string, ...fields: Array<string | undefined>): boolean {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return fields.some((field) => typeof field === "string" && field.toLowerCase().includes(needle));
}

const FALLBACK_FILERS: AlphaRadarTrackedFilerRecord[] = [
    {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Berkshire Hathaway",
        slug: "berkshire-hathaway",
        cik: "0001067983",
        managerName: "Warren Buffett",
        fundStyle: "Concentrated value",
        enabled: true,
    },
    {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Bridgewater Associates",
        slug: "bridgewater-associates",
        cik: "0001350694",
        managerName: "Ray Dalio",
        fundStyle: "Macro multi-asset",
        enabled: true,
    },
    {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Coatue Management",
        slug: "coatue-management",
        cik: "0000941459",
        managerName: "Philippe Laffont",
        fundStyle: "Technology growth",
        enabled: true,
    },
];

const FALLBACK_REPORTS: AlphaRadarReportRecord[] = [
    {
        id: "55555555-5555-4555-8555-555555555555",
        trackedFilerId: FALLBACK_FILERS[0].id,
        filingId: "33333333-3333-4333-8333-333333333333",
        reportPeriod: "2025-Q4",
        status: "generated",
        title: "Berkshire Hathaway Alpha Radar 2025-Q4",
        summary: "Berkshire had 4 ranked 13F changes. Top signal: increased Chubb while trimming Apple. 2 changes overlap with Portfolio Manager objects.",
        sections: [
            { id: "summary", title: "Summary", kind: "summary", markdown: "Berkshire had 4 ranked 13F changes.", changeIds: [] },
            { id: "top-adds", title: "Top adds", kind: "top_adds", markdown: "- Chubb was increased and remains a top insurance signal.", changeIds: [] },
            { id: "trims", title: "Trims and reductions", kind: "trims", markdown: "- Apple was trimmed but remains a major position.", changeIds: [] },
            { id: "exits", title: "Exited positions", kind: "exits", markdown: "- No full exits above materiality threshold.", changeIds: [] },
            { id: "new-positions", title: "New positions", kind: "new_positions", markdown: "- Domino's Pizza appeared as a new tracked position.", changeIds: [] },
            { id: "overlap", title: "Portfolio Manager overlap", kind: "overlap", markdown: "- Apple overlaps with an active thesis and current holdings.", changeIds: [] },
            { id: "watch-next", title: "Watch next", kind: "watch_next", markdown: "- Re-check Apple and Chubb after the next filing.", changeIds: [] },
        ],
        markdown: "",
        sourceFilingIds: ["33333333-3333-4333-8333-333333333333"],
        generatorVersion: "deterministic-v1",
    },
    {
        id: "66666666-6666-4666-8666-666666666666",
        trackedFilerId: FALLBACK_FILERS[1].id,
        filingId: "77777777-7777-4777-8777-777777777777",
        reportPeriod: "2025-Q4",
        status: "generated",
        title: "Bridgewater Associates Alpha Radar 2025-Q4",
        summary: "Bridgewater added defensive staples and reduced mega-cap beta. Gold exposure remained a macro watch item.",
        sections: [
            { id: "summary", title: "Summary", kind: "summary", markdown: "Bridgewater rotated toward defensive exposure.", changeIds: [] },
            { id: "top-adds", title: "Top adds", kind: "top_adds", markdown: "- Procter & Gamble was a material add.", changeIds: [] },
            { id: "trims", title: "Trims and reductions", kind: "trims", markdown: "- Microsoft was reduced.", changeIds: [] },
            { id: "exits", title: "Exited positions", kind: "exits", markdown: "- No major exits.", changeIds: [] },
            { id: "new-positions", title: "New positions", kind: "new_positions", markdown: "- Utilities basket was initiated.", changeIds: [] },
            { id: "overlap", title: "Portfolio Manager overlap", kind: "overlap", markdown: "- Microsoft overlaps with active holdings.", changeIds: [] },
        ],
        markdown: "",
        sourceFilingIds: ["77777777-7777-4777-8777-777777777777"],
        generatorVersion: "deterministic-v1",
    },
    {
        id: "88888888-8888-4888-8888-888888888888",
        trackedFilerId: FALLBACK_FILERS[2].id,
        filingId: "99999999-9999-4999-8999-999999999999",
        reportPeriod: "2025-Q4",
        status: "generated",
        title: "Coatue Management Alpha Radar 2025-Q4",
        summary: "Coatue added AI infrastructure exposure and increased Apple, creating cross-filer overlap with Berkshire.",
        sections: [
            { id: "summary", title: "Summary", kind: "summary", markdown: "Coatue added Nvidia and increased Apple.", changeIds: [] },
            { id: "top-adds", title: "Top adds", kind: "top_adds", markdown: "- Nvidia was added as an AI infrastructure position.", changeIds: [] },
            { id: "overlap", title: "Portfolio Manager overlap", kind: "overlap", markdown: "- Apple overlaps with current holdings and active theses.", changeIds: [] },
        ],
        markdown: "",
        sourceFilingIds: ["99999999-9999-4999-8999-999999999999"],
        generatorVersion: "deterministic-v1",
    },
];

const BASE_RELEVANCE = {
    portfolio: false,
    watchlist: false,
    thesis: false,
    reasons: [] as string[],
    matchedTickers: [] as string[],
    matchedCusips: [] as string[],
};

const FALLBACK_EXTERNAL_OVERLAYS: AlphaRadarExternalOverlay[] = [
    {
        provider: "Seeded research overlay",
        kind: "theme-exposure",
        issuerName: "NVIDIA CORP",
        ticker: "NVDA",
        summary: "AI infrastructure theme tag attached from seeded report language around accelerators and data center demand.",
        asOf: "2026-05-13",
        evidence: [{
            kind: "external-overlay",
            id: "seed-overlay-nvda-ai-infra",
            title: "Seeded Alpha Radar fixture",
            citation: "Demo overlay generated from local fixture text.",
        }],
    },
    {
        provider: "Seeded research overlay",
        kind: "valuation",
        issuerName: "APPLE INC",
        ticker: "AAPL",
        summary: "Valuation overlay flags premium multiple context alongside divergent Berkshire and Coatue 13F changes.",
        asOf: "2026-05-13",
        evidence: [{
            kind: "external-overlay",
            id: "seed-overlay-aapl-valuation",
            title: "Seeded Alpha Radar fixture",
            citation: "Demo overlay generated from local fixture text.",
        }],
    },
    {
        provider: "Seeded research overlay",
        kind: "insider-activity",
        issuerName: "CHUBB LTD",
        ticker: "CB",
        summary: "Insider corroboration overlay is neutral-positive in the seeded fixture and does not override the 13F signal.",
        asOf: "2026-05-13",
        evidence: [{
            kind: "external-overlay",
            id: "seed-overlay-cb-insider",
            title: "Seeded Alpha Radar fixture",
            citation: "Demo overlay generated from local fixture text.",
        }],
    },
];

const FALLBACK_REPORT_PERIOD_END_BY_PERIOD = {
    "2025-Q4": "2025-12-31",
} as const;

const FALLBACK_FILING_ACCEPTED_AT_BY_ID = {
    "33333333-3333-4333-8333-333333333333": "2026-02-14",
    "77777777-7777-4777-8777-777777777777": "2026-02-14",
    "99999999-9999-4999-8999-999999999999": "2026-02-14",
} as const;

const FALLBACK_BENCHMARK_PRICES = [
    { date: "2026-02-14", close: 100, splitAdjusted: true },
    { date: "2026-05-15", close: 106, splitAdjusted: true },
];

const FALLBACK_BACKTEST_PRICES = {
    AAPL: [
        { date: "2026-02-14", close: 190, splitAdjusted: true },
        { date: "2026-05-15", close: 184, splitAdjusted: true },
    ],
    CB: [
        { date: "2026-02-14", close: 255, splitAdjusted: true },
        { date: "2026-05-15", close: 283, splitAdjusted: true },
    ],
    DPZ: [
        { date: "2026-02-14", close: 438, splitAdjusted: true },
        { date: "2026-05-15", close: 462, splitAdjusted: true },
    ],
    MSFT: [
        { date: "2026-02-14", close: 415, splitAdjusted: true },
        { date: "2026-05-15", close: 421, splitAdjusted: true },
    ],
    NVDA: [
        { date: "2026-02-14", close: 128, splitAdjusted: true },
        { date: "2026-05-15", close: 151, splitAdjusted: true },
    ],
    PG: [
        { date: "2026-02-14", close: 162, splitAdjusted: true },
        { date: "2026-05-15", close: 170, splitAdjusted: true },
    ],
} as const;

const FALLBACK_SCHEDULE_RUNS: AlphaRadarScheduledRunRecord[] = [
    {
        id: "alpha-radar-run-demo-weekly",
        scheduleId: "alpha-radar-weekly-refresh",
        scheduleName: "Weekly Alpha Radar refresh",
        cadence: "weekly",
        windowKey: "2026-W19",
        status: "succeeded",
        idempotencyKey: "alpha-radar-demo-weekly-2026-w19",
        requestedAt: "2026-05-08T14:30:00.000Z",
        completedAt: "2026-05-08T14:33:00.000Z",
        attempt: 1,
        queuedJobs: [],
    },
    {
        id: "alpha-radar-run-demo-quarterly",
        scheduleId: "alpha-radar-quarterly-refresh",
        scheduleName: "Quarterly 13F availability sweep",
        cadence: "quarterly",
        windowKey: "2026-Q1",
        status: "failed",
        idempotencyKey: "alpha-radar-demo-quarterly-2026-q1",
        requestedAt: "2026-05-12T15:00:00.000Z",
        completedAt: "2026-05-12T15:01:00.000Z",
        attempt: 1,
        queuedJobs: [],
        failureSummary: "SEC provider timeout; retry remains available without duplicate delivery.",
        error: {
            code: "timeout",
            message: "SEC provider timeout.",
            retryable: true,
        },
    },
];

const FALLBACK_PROVIDER_USAGE: Partial<Record<AlphaRadarProviderKey, AlphaRadarProviderUsage>> = {
    "sec-edgar": {
        provider: "sec-edgar",
        used: 32,
        failures: 1,
        consecutiveFailures: 1,
        lastFailureAt: "2026-05-12T15:01:00.000Z",
        lastStatus: "failed",
        averageLatencyMs: 940,
    },
    "semantic-embedding": {
        provider: "semantic-embedding",
        used: 2,
        failures: 0,
        consecutiveFailures: 0,
        lastStatus: "succeeded",
        averageLatencyMs: 520,
    },
    "external-overlay": {
        provider: "external-overlay",
        used: 1,
        failures: 0,
        consecutiveFailures: 0,
        lastStatus: "succeeded",
        averageLatencyMs: 430,
    },
    "notification-delivery": {
        provider: "notification-delivery",
        used: 4,
        failures: 0,
        consecutiveFailures: 0,
        lastStatus: "succeeded",
        averageLatencyMs: 120,
    },
};

const FALLBACK_OPERATION_EVENTS: AlphaRadarOperationalEvent[] = [
    {
        id: "alpha-radar-demo-ingestion",
        component: "ingestion",
        status: "succeeded",
        occurredAt: "2026-05-12T15:00:15.000Z",
        count: 3,
        durationMs: 940,
    },
    {
        id: "alpha-radar-demo-parser-failure",
        component: "parser",
        status: "failed",
        occurredAt: "2026-05-12T15:00:54.000Z",
        count: 1,
        durationMs: 1_800,
        retryable: true,
        message: "SEC information table timeout.",
    },
    {
        id: "alpha-radar-demo-memo",
        component: "memo",
        status: "succeeded",
        occurredAt: "2026-05-12T15:00:58.000Z",
        count: 1,
        durationMs: 220,
    },
];

const FALLBACK_CHANGES: AlphaRadarMemoChange[] = [
    {
        trackedFilerId: FALLBACK_FILERS[0].id,
        currentFilingId: "33333333-3333-4333-8333-333333333333",
        reportPeriod: "2025-Q4",
        changeType: "increased",
        issuerName: "CHUBB LTD",
        cusip: "H1467J104",
        ticker: "CB",
        currentValueUsd: 7200000000,
        priorValueUsd: 5800000000,
        valueDeltaUsd: 1400000000,
        currentShares: 27000000,
        priorShares: 22000000,
        shareDelta: 5000000,
        currentWeight: 0.064,
        priorWeight: 0.048,
        weightDelta: 0.016,
        materialityScore: 92,
        userRelevance: { ...BASE_RELEVANCE, watchlist: true, reasons: ["watchlist overlap"], matchedTickers: ["CB"] },
        displayReason: "Chubb was increased by roughly $1.4B and moved higher in Berkshire's reported book.",
    },
    {
        trackedFilerId: FALLBACK_FILERS[0].id,
        currentFilingId: "33333333-3333-4333-8333-333333333333",
        reportPeriod: "2025-Q4",
        changeType: "decreased",
        issuerName: "APPLE INC",
        cusip: "037833100",
        ticker: "AAPL",
        currentValueUsd: 82000000000,
        priorValueUsd: 104000000000,
        valueDeltaUsd: -22000000000,
        currentShares: 430000000,
        priorShares: 515000000,
        shareDelta: -85000000,
        currentWeight: 0.42,
        priorWeight: 0.51,
        weightDelta: -0.09,
        materialityScore: 88,
        userRelevance: { ...BASE_RELEVANCE, portfolio: true, thesis: true, reasons: ["portfolio overlap", "active thesis"], matchedTickers: ["AAPL"] },
        displayReason: "Apple was trimmed but remains Berkshire's largest reported public equity position.",
    },
    {
        trackedFilerId: FALLBACK_FILERS[0].id,
        currentFilingId: "33333333-3333-4333-8333-333333333333",
        reportPeriod: "2025-Q4",
        changeType: "new",
        issuerName: "DOMINO'S PIZZA INC",
        cusip: "25754A201",
        ticker: "DPZ",
        currentValueUsd: 550000000,
        currentShares: 1200000,
        currentWeight: 0.008,
        materialityScore: 71,
        userRelevance: BASE_RELEVANCE,
        displayReason: "Domino's Pizza appeared as a new position with enough size to monitor next quarter.",
    },
    {
        trackedFilerId: FALLBACK_FILERS[1].id,
        currentFilingId: "77777777-7777-4777-8777-777777777777",
        reportPeriod: "2025-Q4",
        changeType: "increased",
        issuerName: "PROCTER & GAMBLE CO",
        cusip: "742718109",
        ticker: "PG",
        currentValueUsd: 910000000,
        priorValueUsd: 420000000,
        valueDeltaUsd: 490000000,
        currentShares: 5600000,
        priorShares: 2600000,
        shareDelta: 3000000,
        currentWeight: 0.031,
        priorWeight: 0.014,
        weightDelta: 0.017,
        materialityScore: 82,
        userRelevance: BASE_RELEVANCE,
        displayReason: "Procter & Gamble was a defensive add in Bridgewater's latest reported portfolio.",
    },
    {
        trackedFilerId: FALLBACK_FILERS[2].id,
        currentFilingId: "99999999-9999-4999-8999-999999999999",
        reportPeriod: "2025-Q4",
        changeType: "new",
        issuerName: "NVIDIA CORP",
        cusip: "67066G104",
        ticker: "NVDA",
        currentValueUsd: 1250000000,
        currentShares: 3300000,
        currentWeight: 0.052,
        materialityScore: 91,
        userRelevance: { ...BASE_RELEVANCE, thesis: true, watchlist: true, reasons: ["active thesis", "watchlist overlap"], matchedTickers: ["NVDA"] },
        displayReason: "Nvidia appeared as a new AI infrastructure position in Coatue's latest 13F.",
    },
    {
        trackedFilerId: FALLBACK_FILERS[2].id,
        currentFilingId: "99999999-9999-4999-8999-999999999999",
        reportPeriod: "2025-Q4",
        changeType: "increased",
        issuerName: "APPLE INC",
        cusip: "037833100",
        ticker: "AAPL",
        currentValueUsd: 2100000000,
        priorValueUsd: 1400000000,
        valueDeltaUsd: 700000000,
        currentShares: 11000000,
        priorShares: 7600000,
        shareDelta: 3400000,
        currentWeight: 0.041,
        priorWeight: 0.028,
        weightDelta: 0.013,
        materialityScore: 79,
        userRelevance: { ...BASE_RELEVANCE, portfolio: true, thesis: true, reasons: ["portfolio overlap", "active thesis"], matchedTickers: ["AAPL"] },
        displayReason: "Apple was increased by Coatue, diverging from Berkshire's trim.",
    },
];
