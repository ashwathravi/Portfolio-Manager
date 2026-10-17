import { PageHeaderSync } from "@/components/layout/TopBar";
import { PerformancePageClient } from "@/components/performance/PerformancePageClient";
import { PerformanceExportButton } from "@/components/performance/PerformanceExportButton";

/**
 * Performance › Returns — equity curve vs. benchmark, period metrics, and the
 * monthly heatmap. Attribution and Behaviour are sibling tabs.
 */

export const dynamic = "force-dynamic";

export default function PerformancePage() {
    // One request-time snapshot for the charts and the CSV export, so they
    // show the same months even if the page stays open past month end.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return (
        <>
            <PageHeaderSync
                title="Performance"
                subtitle="Time-weighted return, risk, and period metrics"
                crumbs={["Performance", "Returns"]}
                actions={<PerformanceExportButton now={now} />}
            />
            <PerformancePageClient now={now} />
        </>
    );
}
