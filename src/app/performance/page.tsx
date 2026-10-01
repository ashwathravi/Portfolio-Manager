import { PageHeaderSync } from "@/components/layout/TopBar";
import { PerformancePageClient } from "@/components/performance/PerformancePageClient";
import { PerformanceExportButton } from "@/components/performance/PerformanceExportButton";

/**
 * Performance › Returns — equity curve vs. benchmark, attribution, period
 * metrics, and the monthly heatmap. Behaviour lives at /performance/behaviour.
 */

export const dynamic = "force-dynamic";

export default function PerformancePage() {
    return (
        <>
            <PageHeaderSync
                title="Performance"
                subtitle="Time-weighted return, risk, and attribution"
                crumbs={["Performance", "Returns"]}
                actions={<PerformanceExportButton />}
            />
            <PerformancePageClient />
        </>
    );
}
