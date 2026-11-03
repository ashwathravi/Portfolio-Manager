/**
 * Ticker search helpers shared by the server search (symbol-directory.ts)
 * and the pickers that show its matches (launch item i35).
 */

import type { TickerMatch } from '@/types/market-data';

const MAX_QUERY_LENGTH = 80;

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

export interface TickerQuery {
    /** Lowercased, for matching names. */
    text: string;
    /** As a ticker (BRK B, brk-b and BRK/B are BRK.B), or null when it can't be one. */
    symbol: string | null;
}

export function parseTickerQuery(raw: string): TickerQuery | null {
    const text = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH).toLowerCase();
    return text ? { text, symbol: searchTextAsTicker(text) } : null;
}

/**
 * How well an entry matches, best first: 0 the ticker itself, 1 a ticker
 * starting with it, 2 a name starting with it, 3 a name with a word
 * starting with it, 4 a name containing it; null for no match. The
 * directory query ranks the same way.
 */
export function matchRank(entry: Pick<TickerMatch, 'symbol' | 'name'>, query: TickerQuery): number | null {
    if (query.symbol && entry.symbol === query.symbol) return 0;
    if (query.symbol && entry.symbol.startsWith(query.symbol)) return 1;
    const name = entry.name.toLowerCase();
    if (name.startsWith(query.text)) return 2;
    if (name.includes(` ${query.text}`)) return 3;
    return name.includes(query.text) ? 4 : null;
}

/**
 * An earlier search's matches that still fit what's typed now, for the
 * moment before the new search answers: "appl" keeps AAPL up while "apple"
 * is searched, but after replacing "apple" with "msft", AAPL is gone
 * rather than first in the list for Enter to open.
 */
export function matchesStillTyped(matches: readonly TickerMatch[], raw: string): TickerMatch[] {
    const query = parseTickerQuery(raw);
    return query ? matches.filter((match) => matchRank(match, query) !== null) : [];
}

/** What a match says beside its name: that it's the user's own, or where it lists. */
export function tickerMatchHint(match: Pick<TickerMatch, 'exchange' | 'held'>): string | null {
    return match.held ? 'In your accounts' : match.exchange;
}
