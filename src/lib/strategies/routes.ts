import type { Strategy } from './strategy';

/**
 * URL helpers for the single Strategies workspace.
 *
 * Strategy detail and backtest results used to live on their own legacy
 * routes (`/strategies/[id]`, `/strategies/[id]/backtest`) backed by a
 * separate mock map whose keys never matched the seeded strategies, so
 * every link rendered "Strategy not found". Both routes now redirect into
 * the workspace with the strategy pre-selected.
 */

export const STRATEGY_QUERY_PARAM = 'strategy';

export function strategyHref(id: string): string {
    return `/strategies?${STRATEGY_QUERY_PARAM}=${encodeURIComponent(id)}`;
}

/** Returns true when `id` names one of the given strategies. */
export function isKnownStrategyId(id: string | null | undefined, strategies: readonly Pick<Strategy, 'id'>[]): boolean {
    if (!id) return false;
    return strategies.some((s) => s.id === id);
}

/**
 * Picks the strategy to select on first render: the requested id when it
 * exists, otherwise the first strategy, otherwise an empty string.
 */
export function resolveSelectedStrategyId(
    requested: string | null | undefined,
    strategies: readonly Pick<Strategy, 'id'>[],
): string {
    if (isKnownStrategyId(requested, strategies)) return requested as string;
    return strategies[0]?.id ?? '';
}
