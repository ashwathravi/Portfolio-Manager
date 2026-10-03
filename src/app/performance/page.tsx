import { PageHeaderSync } from "@/components/layout/TopBar";
import { PerformancePageClient } from "@/components/performance/PerformancePageClient";
import { PerformanceExportButton } from "@/components/performance/PerformanceExportButton";

/**
 * Performance › Returns — equity curve vs. benchmark, period metrics, and the
 * monthly heatmap. Attribution and Behaviour are sibling tabs.
 */

export const dynamic = "force-dynamic";

export default function PerformancePage() {
    return (
        <>
            <PageHeaderSync
                title="Performance"
                subtitle="Time-weighted return, risk, and period metrics"
                crumbs={["Performance", "Returns"]}
                actions={<PerformanceExportButton />}
            />
            <PerformancePageClient />
        </>
    );
}
