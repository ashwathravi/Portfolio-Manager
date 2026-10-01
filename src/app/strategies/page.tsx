import { StrategyBuilderClient } from "@/components/strategies/StrategyBuilderClient";
import { SEED_STRATEGIES } from "@/lib/strategies/seed";
import { STRATEGY_QUERY_PARAM, resolveSelectedStrategyId } from "@/lib/strategies/routes";

/**
 * Phase 6 (AR-80/81/82) Strategy Builder workspace.
 *
 * Thin server shell — the client wrapper owns selection state and renders
 * the strategy row, rule builder, and backtest surface. Rendered dynamic
 * so future persistence (draft strategies from the backend) can hydrate
 * on every request without SSR caching surprises.
 *
 * The client owns the page header (title, crumbs, and the Duplicate
 * action, which needs the selected strategy).
 */

export const dynamic = "force-dynamic";

export default async function StrategiesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const requested = params[STRATEGY_QUERY_PARAM];
    const initialStrategyId = resolveSelectedStrategyId(
        typeof requested === "string" ? requested : null,
        SEED_STRATEGIES,
    );
    return (
        <>
            <StrategyBuilderClient initialStrategyId={initialStrategyId} />
        </>
    );
}
