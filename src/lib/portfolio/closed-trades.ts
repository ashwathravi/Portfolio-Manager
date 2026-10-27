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

/** Closed trades, newest first. `rows` can be in any order. */
export function closedTrades(rows: readonly ActivityRow[]): ClosedTrade[] {
    const lots = new Map<string, Lot[]>();
    const closed: ClosedTrade[] = [];
    const trades = rows
        .filter((row) => (row.side === 'BUY' || row.side === 'SELL') && row.symbol && row.currency === 'USD')
        .filter((row) => row.quantity !== null && Math.abs(row.quantity) > 0 && row.price !== null && row.price >= 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.side === 'BUY' && b.side === 'SELL' ? -1 : 0));

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
