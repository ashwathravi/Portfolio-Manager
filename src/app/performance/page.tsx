import { Suspense } from "react";
import { PageHeaderSync } from "@/components/layout/TopBar";
import { PerformancePageClient } from "@/components/performance/PerformancePageClient";
import { PerformanceExportButton } from "@/components/performance/PerformanceExportButton";
import { ReturnHistoryView } from "@/components/performance/ReturnHistoryView";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";
import { SampleGate } from "@/components/data-display/SampleGate";
import { isDatabaseConfigured } from "@/db/connection-options";
import { requirePageUserId } from "@/lib/auth/request-user";
import { dailyExportRows, monthlyExportRows } from "@/lib/performance/export";
import { loadReturnHistory, type ReturnHistory } from "@/lib/performance/return-history";
import { getExampleMonthlySeries } from "@/lib/performance/series";
import PerformanceLoading from "./loading";

/**
 * Performance › Returns — equity curve vs. benchmark, period metrics, and the
 * monthly heatmap. Attribution and Behaviour are sibling tabs.
 *
 * With valuation history (launch item i49) it shows the user's own
 * time-weighted return, all accounts together or the one in `?account=`.
 * Before the first valuation it shows the example series, behind
 * "Show example data".
 */

export const dynamic = "force-dynamic";

const TITLE = "Performance";
const SUBTITLE = "Time-weighted return, risk, and period metrics";
const CRUMBS = ["Performance", "Returns"];

async function ReturnsContent({ accountId }: { accountId: string | null }) {
    const userId = await requirePageUserId();
    let history: ReturnHistory | null = null;
    let unavailable = false;
    try {
        history = await loadReturnHistory(userId, { accountId });
    } catch (e) {
        // With a configured database a failure is an outage, not a user
        // without history; without one (local runs) the example stands.
        unavailable = isDatabaseConfigured();
        if (unavailable) console.error("Return history fetch failed — showing the outage notice.", e);
        else console.warn("Return history fetch failed without a configured database — showing example data.", e);
    }

    if (unavailable) {
        return (
            <div className="pm-perf-stack">
                <DataUnavailableNotice what="your return history" />
            </div>
        );
    }

    if (history?.hasHistory) {
        const account = history.accounts.find((a) => a.id === history.accountId)?.name ?? "All accounts";
        const benchmark = history.benchmarks[0];
        const rows = dailyExportRows(
            account,
            history.points,
            benchmark ? { label: `${benchmark.label} (${benchmark.symbol})`, values: benchmark.values } : null,
        );
        return (
            <>
                <PageHeaderSync
                    title={TITLE}
                    subtitle={SUBTITLE}
                    crumbs={CRUMBS}
                    actions={rows.length > 0 ? <PerformanceExportButton filename="atlas-daily-returns.csv" rows={rows} /> : undefined}
                />
                <ReturnHistoryView history={history} />
            </>
        );
    }

    // One request-time snapshot for the charts and the CSV export, so they
    // show the same months even if the page stays open past month end.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const { portfolio, benchmark } = getExampleMonthlySeries(now);
    return (
        <>
            <PageHeaderSync
                title={TITLE}
                subtitle={SUBTITLE}
                crumbs={CRUMBS}
                actions={
                    <SampleGate>
                        <PerformanceExportButton filename="atlas-monthly-returns.csv" rows={monthlyExportRows(portfolio, benchmark)} />
                    </SampleGate>
                }
            />
            <PerformancePageClient now={now} />
        </>
    );
}

export default async function PerformancePage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { account } = await searchParams;
    return (
        <>
            <PageHeaderSync title={TITLE} subtitle={SUBTITLE} crumbs={CRUMBS} />
            <Suspense fallback={<PerformanceLoading />}>
                <ReturnsContent accountId={typeof account === "string" ? account : null} />
            </Suspense>
        </>
    );
}
