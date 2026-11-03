/**
 * Ticker search helpers shared by the server search (symbol-directory.ts)
 * and the pickers that show its matches (launch item i35).
 */

import type { TickerMatch } from '@/types/market-data';

/**
 * Typed search text as a ticker, the way the directory writes one: brk b,
 * brk-b and BRK/B are all BRK.B (a class share), while BTC-USD stays as it
 * is. Null when it can't be a ticker ("apple inc").
 */
export function searchTextAsTicker(raw: string): string | null {
    const upper = raw.trim().replace(/\s+/g, ' ').toUpperCase();
    const classShare = /^([A-Z]{1,5})[ /.-]([A-Z]{1,2})$/.exec(upper);
    const symbol = classShare ? `${classShare[1]}.${classShare[2]}` : upper;
    return /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(symbol) && symbol.length <= 10 ? symbol : null;
}

/** What a match says beside its name: that it's the user's own, or where it lists. */
export function tickerMatchHint(match: Pick<TickerMatch, 'exchange' | 'held'>): string | null {
    return match.held ? 'In your accounts' : match.exchange;
}
