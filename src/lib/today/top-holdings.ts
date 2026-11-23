/**
 * Today › Top holdings: the user's largest holdings by value, those with a
 * ticker at their latest quote and those valued by hand (a 401(k)'s trust
 * fund, a 529 portfolio) at the value given. A book of only the second kind,
 * which a 401(k) positions file now becomes, is listed like any other,
 * never as "no holdings".
 */

/** A holding with a ticker, as the server prices it before any live quote. */
export interface TopHoldingsRow {
    id: string;
    symbol: string;
    name: string;
    quantity: number;
    avgCost: number;
    currentPrice: number;
    marketValue: number;
}

/** A holding valued by hand: no ticker and no quote, only the value given. */
export interface TopHoldingsHandValuedRow {
    id: string;
    name: string;
    /** Units, when it has them. */
    quantity: number | null;
    value: number;
    costBasis: number | null;
}

/** The quote a ticker row is priced at, when there is one. */
export interface TopHoldingsQuote {
    price: number;
    /** Today's move, %: null when the quote is an earlier session's. */
    todayChangePercent: number | null;
}

/** One line of the card. */
export interface TopHoldingLine {
    id: string;
    /** The ticker; null for a holding valued by hand. */
    symbol: string | null;
    name: string;
    quantity: number | null;
    marketValue: number;
    /** Null without today's move: an earlier session's quote, or a holding valued by hand. */
    todayChangePercent: number | null;
    /** Null without a cost to measure it from. */
    totalReturnPercent: number | null;
    /** Its share of every holding listed or not, %. */
    allocationPercent: number;
    handValued: boolean;
}

export interface TopHoldings {
    lines: TopHoldingLine[];
    /** How many holdings there are, of both kinds: what the lines are the top of. */
    total: number;
}

/**
 * The `limit` largest holdings by value, with each one's share of them all.
 * A ticker row is priced at its quote, else at the server's price; a
 * holding valued by hand counts at its value, with no today's move, and a
 * total return only when it has a cost.
 */
export function topHoldings(
    rows: readonly TopHoldingsRow[],
    handValued: readonly TopHoldingsHandValuedRow[],
    quoteFor: (symbol: string) => TopHoldingsQuote | undefined,
    limit: number,
): TopHoldings {
    const priced = rows.map((r) => {
        const quote = quoteFor(r.symbol);
        const price = quote && Number.isFinite(quote.price) ? quote.price : r.currentPrice;
        return {
            id: r.id,
            symbol: r.symbol,
            name: r.name,
            quantity: r.quantity,
            marketValue: r.quantity * price,
            todayChangePercent: quote?.todayChangePercent ?? null,
            totalReturnPercent: r.avgCost > 0 ? ((price - r.avgCost) / r.avgCost) * 100 : 0,
            handValued: false,
        };
    });
    const byHand = handValued.map((h) => ({
        id: h.id,
        symbol: null,
        name: h.name,
        quantity: h.quantity,
        marketValue: h.value,
        todayChangePercent: null,
        totalReturnPercent: h.costBasis != null && h.costBasis > 0 ? ((h.value - h.costBasis) / h.costBasis) * 100 : null,
        handValued: true,
    }));
    const all = [...priced, ...byHand];
    const totalValue = all.reduce((sum, line) => sum + line.marketValue, 0);
    const lines = all
        .sort((a, b) => b.marketValue - a.marketValue)
        .slice(0, limit)
        .map((line) => ({ ...line, allocationPercent: totalValue > 0 ? (line.marketValue / totalValue) * 100 : 0 }));
    return { lines, total: all.length };
}
