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

/** Whatever its case: some callers upper-case every symbol they get. */
export function isManualSymbol(symbol: string): boolean {
    return symbol.slice(0, MANUAL_SYMBOL_PREFIX.length).toLowerCase() === MANUAL_SYMBOL_PREFIX;
}

/**
 * In a snapshot the holding's "close" is either its whole value or the
 * value of one unit (manualPositionOn). The two don't compare, so a close
 * of one unit goes by this suffix: a return is only taken between closes
 * of the same scale.
 */
export const MANUAL_UNIT_SUFFIX = "/unit";

/** The snapshot symbol of a hand-valued holding whose close is per unit. */
export function manualUnitSymbol(id: string): string {
    return `${manualSymbol(id)}${MANUAL_UNIT_SUFFIX}`;
}

/** The hand-valued holding's id in `symbol`, whatever its scale; null for a ticker. */
export function manualHoldingId(symbol: string): string | null {
    if (!isManualSymbol(symbol)) return null;
    const rest = symbol.slice(MANUAL_SYMBOL_PREFIX.length);
    return rest.endsWith(MANUAL_UNIT_SUFFIX) ? rest.slice(0, -MANUAL_UNIT_SUFFIX.length) : rest;
}
