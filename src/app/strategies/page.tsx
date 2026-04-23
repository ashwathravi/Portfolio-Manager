import { PageHeaderSync } from "@/components/layout/TopBar";
import { StrategyBuilderClient } from "@/components/strategies/StrategyBuilderClient";

/**
 * Phase 6 (AR-80/81/82) Strategy Builder workspace.
 *
 * Thin server shell — the client wrapper owns selection state and renders
 * the strategy row, rule builder, and backtest surface. Rendered dynamic
 * so future persistence (draft strategies from the backend) can hydrate
 * on every request without SSR caching surprises.
 *
 * Breadcrumbs, title, subtitle, and header actions are all synced from
 * here via `PageHeaderSync` so the top bar matches the rest of the Phase
 * 4/5 redesigned surface.
 */

export const dynamic = "force-dynamic";

export default function StrategiesPage() {
    return (
        <>
            <PageHeaderSync
                title="Strategy builder"
                subtitle="Rules → backtest → robustness → paper → live. Earn automation."
                crumbs={["Workspace", "Strategies", "Builder"]}
                actions={
                    <div className="pm-strategy-topbar-actions">
                        <button type="button" className="pm-btn pm-btn-ghost">
                            Duplicate
                        </button>
                        <button type="button" className="pm-btn pm-btn-primary">
                            Run backtest
                        </button>
                    </div>
                }
            />
            <StrategyBuilderClient />
        </>
    );
}
