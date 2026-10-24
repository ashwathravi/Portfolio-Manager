import { Suspense } from "react";
import { PageHeaderSync } from "@/components/layout/TopBar";
import { PerformancePageClient } from "@/components/performance/PerformancePageClient";
import { PerformanceExportButton } from "@/components/performance/PerformanceExportButton";
import { ReturnHistoryView } from "@/components/performance/ReturnHistoryView";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";
import { SampleGate } from "@/components/data-display/SampleGate";
import { requirePageUserId } from "@/lib/auth/request-user";
import { dailyExportRows, monthlyExportRows } from "@/lib/performance/export";
import { loadPageReturnHistory } from "@/lib/performance/return-history";
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
    const { history, unavailable } = await loadPageReturnHistory(userId, { accountId });

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
