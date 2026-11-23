/**
 * The Holdings table's sort: by market value, total return, today's move or
 * allocation, largest first, with rows that have no figure last.
 *
 * Rows that tie go by symbol, then account name, then account ID. The
 * holdings query has no ORDER BY (buildUserHoldingsQuery in
 * src/lib/portfolio-repository.ts), so equal rows, common among small
 * positions valued at cost, could otherwise swap places between loads.
 */

export type HoldingsSortKey = "marketValue" | "totalReturnPct" | "todayPct" | "allocationPct";

/** What the sort reads from a row: one account's position, or one symbol's (By symbol). */
export interface SortableHolding {
    symbol: string;
    accountId: string;
    account: string;
    marketValue: number;
    totalReturnPct: number | null;
    todayPct: number | null;
    allocationPct: number;
}

/** The rows in the table's order, as a new array; the one given is left as it was. */
export function sortHoldings<T extends SortableHolding>(rows: readonly T[], key: HoldingsSortKey): T[] {
    return [...rows].sort((a, b) =>
        compareByKey(a, b, key)
        || a.symbol.localeCompare(b.symbol, "en-US")
        || a.account.localeCompare(b.account, "en-US", { sensitivity: "base" })
        || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
}

function compareByKey(a: SortableHolding, b: SortableHolding, key: HoldingsSortKey): number {
    switch (key) {
        case "marketValue":
            return b.marketValue - a.marketValue;
        case "totalReturnPct":
            // Rows without a price sort last.
            return (b.totalReturnPct ?? -Infinity) - (a.totalReturnPct ?? -Infinity) || 0;
        case "todayPct":
            // Rows without a move today sort last.
            return (b.todayPct ?? -Infinity) - (a.todayPct ?? -Infinity) || 0;
        case "allocationPct":
            return b.allocationPct - a.allocationPct;
    }
}
