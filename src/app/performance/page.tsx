import { PageHeaderSync } from "@/components/layout/TopBar";
import { PerformancePageClient } from "@/components/performance/PerformancePageClient";

/**
 * Phase 4 (AR-75 / AR-76 / AR-77) Performance page.
 *
 * The heavy lifting lives in the client child. The server half only wires
 * the app-shell topbar to the new page header so the rest of the Workspace
 * chrome stays in sync.
 */

export const dynamic = "force-dynamic";

export default function PerformancePage() {
    return (
        <>
            <PageHeaderSync
                title="Performance"
                subtitle="Time-weighted return, risk, and attribution"
                crumbs={["Workspace", "Performance"]}
            />
            <PerformancePageClient />
        </>
    );
}
