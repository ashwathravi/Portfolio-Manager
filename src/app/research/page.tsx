import { PageHeaderSync } from "@/components/layout/TopBar";
import { ResearchPageClient } from "@/components/research/ResearchPageClient";

/**
 * Phase 5 (AR-78) Research workspace.
 *
 * Thin server shell — the client wrapper owns all state (selected tab,
 * selected thesis, filter query, modal lifecycle). Rendered dynamic so
 * localStorage-backed theses can hydrate on every request without any
 * baked-in SSR surprises.
 */

export const dynamic = "force-dynamic";

export default function ResearchPage() {
    return (
        <>
            <PageHeaderSync
                title="Research"
                subtitle="Theses, watchlist, and decision journal"
                crumbs={["Workspace", "Research"]}
            />
            <ResearchPageClient />
        </>
    );
}
