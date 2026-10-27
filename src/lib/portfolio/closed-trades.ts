/**
 * Closed trades from the user's transactions: each sale matched against the
 * buys before it in the same account, first in first out, for the realized
 * gain or loss. Ask answers "where did P&L come from" and "my winning
 * trades" from these (launch item i56); behaviour and reviews can too (i51).
 *
 * - Fees count: a buy's add to its cost, a sale's come out of its proceeds.
 * - Only dollar trades are matched: amounts in different currencies aren't
 *   added together.
 * - Shares sold with no recorded buy before them (a position imported with
 *   its average cost, say) have no known cost, so that part of the sale
 *   isn't a closed trade.
 * - Splits: transactions keep the share scale of their day, and no split
 *   events are stored, but stored closes are split-adjusted. A trade whose
 *   price is a split ratio away from that day's adjusted close was made
 *   before the split, and is put on today's scale (10 shares at $100 before
 *   a 2-for-1 split are 20 at $50). A ticker with a split whose scale can't
 *   be told for every trade (no close that day) is left out.
 */

import type { ActivityRow } from './activity';

export interface ClosedTrade {
    /** The sale's transaction id. */
    id: string;
    symbol: string;
    account: string;
    /** ISO timestamp of the earliest buy matched. */
    openedAt: string;
    /** ISO timestamp of the sale. */
    closedAt: string;
    /** Shares closed: the matched part of the sale. */
    quantity: number;
    costBasis: number;
    proceeds: number;
    realizedPnl: number;
}

interface Lot {
    date: string;
    quantity: number;
    /** Cost per share, its buy's fees included. */
    unitCost: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Split ratios (and their reverses) a trade's price can be off by. */
const SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 100];

/**
 * How many of today's shares one share of a trade on its day is: 1 when its
 * price is within a quarter of the day's adjusted close, the split ratio it
 * is within a tenth of, or null when neither (or there's no close).
 */
export function shareScale(price: number, adjustedClose: number | null): number | null {
    if (!(price > 0) || adjustedClose === null || !(adjustedClose > 0)) return null;
    const ratio = price / adjustedClose;
    if (ratio >= 0.8 && ratio <= 1.25) return 1;
    for (const split of SPLIT_RATIOS) {
        for (const scale of [split, 1 / split]) {
            if (Math.abs(ratio / scale - 1) <= 0.1) return scale;
        }
    }
    return null;
}

export interface ClosedTradeOptions {
    /** The split-adjusted close of `symbol` on `date` (YYYY-MM-DD), or null. */
    adjustedClose?: (symbol: string, date: string) => number | null;
}

/** Each ticker's trades on today's share scale; a ticker that split and can't be put on it is left out. */
function onTodaysScale(trades: readonly ActivityRow[], adjustedClose: ClosedTradeOptions['adjustedClose']): ActivityRow[] {
    if (!adjustedClose) return [...trades];
    const bySymbol = new Map<string, ActivityRow[]>();
    for (const trade of trades) bySymbol.set(trade.symbol!, [...(bySymbol.get(trade.symbol!) ?? []), trade]);
    return [...bySymbol.values()].flatMap((own) => {
        const scales = own.map((trade) => shareScale(trade.price!, adjustedClose(trade.symbol!, trade.date.slice(0, 10))));
        if (scales.every((scale) => scale === 1 || scale === null)) return own;
        if (scales.some((scale) => scale === null)) return [];
        return own.map((trade, i) => ({ ...trade, quantity: trade.quantity! * scales[i]!, price: trade.price! / scales[i]! }));
    });
}

/** Closed trades, newest first. `rows` can be in any order. */
export function closedTrades(rows: readonly ActivityRow[], { adjustedClose }: ClosedTradeOptions = {}): ClosedTrade[] {
    const lots = new Map<string, Lot[]>();
    const closed: ClosedTrade[] = [];
    const trades = onTodaysScale(
        rows
            .filter((row) => (row.side === 'BUY' || row.side === 'SELL') && row.symbol && row.currency === 'USD')
            .filter((row) => row.quantity !== null && Math.abs(row.quantity) > 0 && row.price !== null && row.price >= 0),
        adjustedClose,
    ).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.side === 'BUY' && b.side === 'SELL' ? -1 : 0));

    for (const row of trades) {
        const key = `${row.account}\u0000${row.symbol}`;
        const quantity = Math.abs(row.quantity!);
        const fees = Math.max(0, row.fees ?? 0);
        const open = lots.get(key) ?? [];
        if (row.side === 'BUY') {
            open.push({ date: row.date, quantity, unitCost: (quantity * row.price! + fees) / quantity });
            lots.set(key, open);
            continue;
        }

        let remaining = quantity;
        let matched = 0;
        let costBasis = 0;
        let openedAt: string | null = null;
        while (remaining > 1e-9 && open.length > 0) {
            const lot = open[0];
            const take = Math.min(lot.quantity, remaining);
            costBasis += take * lot.unitCost;
            matched += take;
            remaining -= take;
            lot.quantity -= take;
            openedAt ??= lot.date;
            if (lot.quantity <= 1e-9) open.shift();
        }
        if (matched <= 0) continue;
        // The sale's fees, in proportion to the part matched.
        const proceeds = matched * row.price! - fees * (matched / quantity);
        closed.push({
            id: row.id,
            symbol: row.symbol!,
            account: row.account,
            openedAt: openedAt!,
            closedAt: row.date,
            quantity: matched,
            costBasis: round(costBasis),
            proceeds: round(proceeds),
            realizedPnl: round(proceeds - costBasis),
        });
    }

    return closed.sort((a, b) => (a.closedAt < b.closedAt ? 1 : a.closedAt > b.closedAt ? -1 : 0));
}
