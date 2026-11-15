import { StrategyBuilderClient } from "@/components/strategies/StrategyBuilderClient";
import { requirePageUserId } from "@/lib/auth/request-user";
import { STRATEGY_QUERY_PARAM } from "@/lib/strategies/routes";
import { loadStrategiesPage } from "@/lib/strategies/server";

/**
 * Strategy Builder workspace (AR-80/81/82).
 *
 * Thin server shell: loads the user's saved strategies (launch item i55)
 * and hands them to the client, which owns selection, editing, saving
 * and backtests, and the page header (its actions need the selection).
 */

export const dynamic = "force-dynamic";

export default async function StrategiesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const userId = await requirePageUserId();
    const [params, data] = await Promise.all([searchParams, loadStrategiesPage(userId)]);
    const requested = params[STRATEGY_QUERY_PARAM];
    return <StrategyBuilderClient data={data} requestedId={typeof requested === "string" ? requested : undefined} />;
}
