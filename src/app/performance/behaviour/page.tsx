import { Suspense } from "react";
import { PageHeaderSync } from "@/components/layout/TopBar";
import { BehaviourPageClient } from "@/components/performance/BehaviourPageClient";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";
import { requirePageUserId } from "@/lib/auth/request-user";
import { loadTradeJournalForPage } from "@/lib/journal/server";
import PerformanceLoading from "../loading";

/**
 * Performance › Behaviour — trading calendar, closed trades, mood, time of
 * day and weekly reviews, from the user's closed trades (launch item i51).
 * Before the first one it shows the example journal, behind "Show example
 * data".
 */

export const dynamic = "force-dynamic";

async function BehaviourContent() {
    const userId = await requirePageUserId();
    const { journal, unavailable } = await loadTradeJournalForPage(userId);
    if (unavailable) {
        return (
            <div className="pm-perf-stack">
                <DataUnavailableNotice what="your trades" />
            </div>
        );
    }
    return <BehaviourPageClient journal={journal} />;
}

export default function BehaviourPage() {
    return (
        <>
            <PageHeaderSync
                title="Performance"
                subtitle="How you trade: timing, mood, and weekly reviews"
                crumbs={["Performance", "Behaviour"]}
            />
            <Suspense fallback={<PerformanceLoading />}>
                <BehaviourContent />
            </Suspense>
        </>
    );
}
