/**
 * The key a holding valued by hand (manual_holdings) goes by where a
 * ticker would: snapshot positions, the risk policy. Kept apart from the
 * database code so the browser can use it.
 */

/**
 * Its own "symbol", which no ticker has (tickers have no colon), so
 * Returns, attribution and the policy can tell it apart and never look up
 * a price for it.
 */
export const MANUAL_SYMBOL_PREFIX = "manual:";

export function manualSymbol(id: string): string {
    return `${MANUAL_SYMBOL_PREFIX}${id}`;
}

export function isManualSymbol(symbol: string): boolean {
    return symbol.startsWith(MANUAL_SYMBOL_PREFIX);
}
