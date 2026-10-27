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
 *   events are stored, so a buy and a sale either side of a split can't be
 *   put on one scale. Stored closes are split-adjusted, though: a trade
 *   whose price is far from its day's adjusted close (more than a quarter
 *   either way) was likely made before a split, or at least can't be
 *   trusted against it, so its ticker is left out rather than matched on
 *   a guessed ratio (`tickersLeftOut` names them).
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

/**
 * Whether a trade's price is too far from its day's split-adjusted close to
 * be on today's share scale: more than a quarter either way. Without a
 * close there's nothing to tell by.
 */
export function offScale(price: number, adjustedClose: number | null): boolean {
    if (adjustedClose === null || !(adjustedClose > 0) || !(price > 0)) return false;
    const ratio = price / adjustedClose;
    return ratio < 0.8 || ratio > 1.25;
}

export interface ClosedTradeOptions {
    /** The split-adjusted close of `symbol` on `date` (YYYY-MM-DD), or null. */
    adjustedClose?: (symbol: string, date: string) => number | null;
}

function trades(rows: readonly ActivityRow[]): ActivityRow[] {
    return rows
        .filter((row) => (row.side === 'BUY' || row.side === 'SELL') && row.symbol && row.currency === 'USD')
        .filter((row) => row.quantity !== null && Math.abs(row.quantity) > 0 && row.price !== null && row.price >= 0);
}

/** Tickers left out of closed trades: one of their trades is off today's share scale. */
export function tickersLeftOut(rows: readonly ActivityRow[], { adjustedClose }: ClosedTradeOptions = {}): string[] {
    if (!adjustedClose) return [];
    const left = new Set<string>();
    for (const trade of trades(rows)) {
        if (offScale(trade.price!, adjustedClose(trade.symbol!, trade.date.slice(0, 10)))) left.add(trade.symbol!);
    }
    return [...left].sort();
}

/** Closed trades, newest first. `rows` can be in any order. */
export function closedTrades(rows: readonly ActivityRow[], options: ClosedTradeOptions = {}): ClosedTrade[] {
    const lots = new Map<string, Lot[]>();
    const closed: ClosedTrade[] = [];
    const leftOut = new Set(tickersLeftOut(rows, options));
    const matched = trades(rows)
        .filter((row) => !leftOut.has(row.symbol!))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.side === 'BUY' && b.side === 'SELL' ? -1 : 0));

    for (const row of matched) {
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
