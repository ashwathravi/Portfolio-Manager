import { PageHeaderSync } from "@/components/layout/TopBar";
import { AttributionPageClient } from "@/components/performance/AttributionPageClient";

/** Performance › Attribution — what explains the gap to the benchmark. */

export const dynamic = "force-dynamic";

export default function AttributionPage() {
    return (
        <>
            <PageHeaderSync
                title="Performance"
                subtitle="What explains the gap to your benchmark"
                crumbs={["Performance", "Attribution"]}
            />
            <AttributionPageClient />
        </>
    );
}
