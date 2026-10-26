import { Suspense } from "react";
import { PageHeaderSync } from "@/components/layout/TopBar";
import { AttributionHistoryView } from "@/components/performance/AttributionHistoryView";
import { AttributionPageClient } from "@/components/performance/AttributionPageClient";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";
import { isDatabaseConfigured } from "@/db/connection-options";
import { requirePageUserId } from "@/lib/auth/request-user";
import { loggableError } from "@/lib/observability/loggable-error";
import { loadAttributionHistory, type AttributionHistory } from "@/lib/performance/attribution-loader";
import PerformanceLoading from "../loading";

/**
 * Performance › Attribution — what explains the gap to the benchmark.
 *
 * With valuation history (launch item i50) it attributes the user's own
 * return against the S&P 500 by sector, all accounts together or the one
 * in `?account=`. Before the first valuation it shows the example
 * breakdown, behind "Show example data".
 */

export const dynamic = "force-dynamic";

const TITLE = "Performance";
const SUBTITLE = "What explains the gap to your benchmark";
const CRUMBS = ["Performance", "Attribution"];

async function AttributionContent({ accountId }: { accountId: string | null }) {
    const userId = await requirePageUserId();
    let history: AttributionHistory | null = null;
    // Without a database there is no history to read: the example stands.
    if (isDatabaseConfigured()) {
        try {
            history = await loadAttributionHistory(userId, { accountId });
        } catch (e) {
            // With a configured database a failure is an outage, not a user without history.
            // Logged during a render, so an AggregateError can't go to the console as is.
            console.error("Attribution history fetch failed — showing the outage notice.", loggableError(e));
            return (
                <div className="pm-perf-stack">
                    <DataUnavailableNotice what="your attribution" />
                </div>
            );
        }
    }
    // Keyed by account: switching starts the period choice afresh.
    return history?.hasHistory
        ? <AttributionHistoryView key={history.accountId ?? "all"} history={history} />
        : <AttributionPageClient />;
}

export default async function AttributionPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { account } = await searchParams;
    return (
        <>
            <PageHeaderSync title={TITLE} subtitle={SUBTITLE} crumbs={CRUMBS} />
            <Suspense fallback={<PerformanceLoading />}>
                <AttributionContent accountId={typeof account === "string" ? account : null} />
            </Suspense>
        </>
    );
}
