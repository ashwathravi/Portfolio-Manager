"use client";

import Link from "next/link";
import { AlertCircle, ExternalLink, RefreshCw } from "lucide-react";
import {
    useAlphaRadarFilersQuery,
    useAlphaRadarReportsQuery,
    useRefreshAlphaRadarAllMutation,
} from "@/lib/api/alpha-radar/queries";
import type {
    AlphaRadarReportRecord,
    AlphaRadarTrackedFilerRecord,
} from "@/lib/alpha-radar";

const RESEARCH_ALPHA_RADAR_HREF = "/research?tab=alpha-radar";
const ALPHA_RADAR_HELP_HREF = "/help#alpha-radar-v1";

export function AlphaRadarDashboardCard() {
    const filersQuery = useAlphaRadarFilersQuery({
        retry: false,
        refetchOnWindowFocus: false,
    });
    const reportsQuery = useAlphaRadarReportsQuery(
        {},
        {
            retry: false,
            refetchOnWindowFocus: false,
        },
    );
    const refresh = useRefreshAlphaRadarAllMutation();

    const liveFilers = filersQuery.data ?? [];
    const liveReports = reportsQuery.data ?? [];
    const filers = liveFilers.length > 0 ? liveFilers : FALLBACK_FILERS;
    const reports = liveReports.length > 0 ? liveReports : FALLBACK_REPORTS;
    const latestReports = [...reports]
        .sort((a, b) => b.reportPeriod.localeCompare(a.reportPeriod))
        .slice(0, 3);
    const filerById = new Map(filers.map((filer) => [filer.id, filer] as const));
    const enabledCount = filers.filter((filer) => filer.enabled).length;
    const topReport = latestReports[0];
    const topFiler = topReport ? filerById.get(topReport.trackedFilerId) : undefined;
    const isFallback = liveFilers.length === 0 || liveReports.length === 0 || Boolean(filersQuery.error) || Boolean(reportsQuery.error);

    return (
        <section
            className="pm-card pm-card-stack pm-alpha-dashboard-card"
            aria-label="Alpha Radar"
            data-testid="alpha-radar-dashboard-card"
        >
            <header className="pm-card-header">
                <div>
                    <h3 className="pm-card-title">Alpha Radar</h3>
                    <p className="pm-card-subtitle">
                        Latest 13F changes from tracked managers
                    </p>
                </div>
                <div className="pm-alpha-dashboard-actions">
                    <button
                        type="button"
                        className="pm-btn pm-btn-secondary"
                        onClick={() => refresh.mutate({ force: true, filingLimit: 1 })}
                        disabled={refresh.isPending}
                        data-testid="alpha-radar-dashboard-refresh"
                    >
                        <RefreshCw size={14} aria-hidden="true" />
                        <span>{refresh.isPending ? "Refreshing" : "Refresh"}</span>
                    </button>
                    <Link href={RESEARCH_ALPHA_RADAR_HREF} className="pm-card-link">
                        Open <ExternalLink size={12} aria-hidden="true" />
                    </Link>
                    <Link href={ALPHA_RADAR_HELP_HREF} className="pm-card-link" data-testid="alpha-radar-dashboard-help">
                        Guide <ExternalLink size={12} aria-hidden="true" />
                    </Link>
                </div>
            </header>

            {isFallback && (
                <div className="pm-alpha-dashboard-status" data-testid="alpha-radar-dashboard-fallback">
                    <AlertCircle size={14} aria-hidden="true" />
                    <span>
                        Showing seeded Alpha Radar data until live 13F storage is available.{" "}
                        <a href={ALPHA_RADAR_HELP_HREF}>Read the guide</a>
                    </span>
                </div>
            )}

            <div className="pm-alpha-dashboard-summary" data-testid="alpha-radar-dashboard-summary">
                <AlphaRadarDashboardMetric label="Tracked" value={enabledCount.toString()} />
                <AlphaRadarDashboardMetric label="Reports" value={latestReports.length.toString()} />
                <AlphaRadarDashboardMetric label="Latest" value={topReport?.reportPeriod ?? "None"} />
            </div>

            {topReport ? (
                <Link href={RESEARCH_ALPHA_RADAR_HREF} className="pm-alpha-dashboard-headline">
                    <span>{topFiler?.name ?? "Tracked filer"}</span>
                    <strong>{topReport.title}</strong>
                    <small>{topReport.summary}</small>
                </Link>
            ) : (
                <p className="pm-card-subtitle">No Alpha Radar reports generated yet.</p>
            )}

            <div className="pm-alpha-dashboard-list" aria-label="Latest Alpha Radar reports">
                {latestReports.map((report) => {
                    const filer = filerById.get(report.trackedFilerId);
                    return (
                        <Link
                            key={report.id}
                            href={RESEARCH_ALPHA_RADAR_HREF}
                            className="pm-alpha-dashboard-row"
                            data-testid="alpha-radar-dashboard-row"
                        >
                            <span>
                                <strong>{filer?.name ?? "Tracked filer"}</strong>
                                <small>{report.summary}</small>
                            </span>
                            <em>{report.reportPeriod}</em>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}

function AlphaRadarDashboardMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="pm-alpha-dashboard-metric">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
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
        summary: "Increased Chubb, trimmed Apple, and surfaced two Portfolio Manager overlaps.",
        sections: [
            { id: "summary", title: "Summary", kind: "summary", markdown: "Berkshire had 4 ranked 13F changes.", changeIds: [] },
        ],
        markdown: "Berkshire had 4 ranked 13F changes.",
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
        summary: "Rotated toward defensive exposure while reducing mega-cap beta.",
        sections: [
            { id: "summary", title: "Summary", kind: "summary", markdown: "Bridgewater rotated toward defensive exposure.", changeIds: [] },
        ],
        markdown: "Bridgewater rotated toward defensive exposure.",
        sourceFilingIds: ["77777777-7777-4777-8777-777777777777"],
        generatorVersion: "deterministic-v1",
    },
];
