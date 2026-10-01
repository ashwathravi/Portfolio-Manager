import { PageHeaderSync } from "@/components/layout/TopBar";
import { BehaviourPageClient } from "@/components/performance/BehaviourPageClient";

/** Performance › Behaviour — trading calendar, mood, time-of-day, and weekly reviews. */

export const dynamic = "force-dynamic";

export default function BehaviourPage() {
    return (
        <>
            <PageHeaderSync
                title="Performance"
                subtitle="How you trade: timing, mood, and weekly reviews"
                crumbs={["Performance", "Behaviour"]}
            />
            <BehaviourPageClient />
        </>
    );
}
