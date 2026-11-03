/**
 * Holdings' "By symbol" view (launch item i79): one row per symbol across
 * every account, next to the default one row per account position.
 *
 * Shares, cost and value add up, and the cost per share is blended over all
 * of them, as on the symbol's detail page. A combined row is worth exactly
 * what its account rows are worth, so the table always agrees with the
 * summary above it.
 */

export type HoldingsRowView = "account" | "symbol";

/** The `?view=` value on Holdings; anything but "symbol" is one row per account position. */
export function parseHoldingsRowView(value: unknown): HoldingsRowView {
    return value === "symbol" ? "symbol" : "account";
}

/** One account's position in a symbol, as the Holdings table values it. */
export interface AccountPosition {
    id: string;
    symbol: string;
    account: string;
    quantity: number;
    /** What the shares cost: quantity × average cost. */
    costBasis: number;
    /** At `last`, or at cost when there is no price. */
    marketValue: number;
    /** Null when there is no price for it yet. */
    last: number | null;
    /** Today's move in the symbol; null when there is none from today's session. */
    todayPct: number | null;
    todayChangeAbs: number;
    allocationPct: number;
}

export interface SymbolPosition {
    /** "symbol:" and the ticker, so it never matches a holding's ID. */
    id: string;
    quantity: number;
    /** Cost over shares, across every account. */
    avgCost: number;
    costBasis: number;
    marketValue: number;
    /** Null when none of the shares has a price. */
    last: number | null;
    /** Some of the shares, not all, have no price and are counted at cost. */
    partlyAtCost: boolean;
    /** Over the shares with a price; null when none has one. */
    totalReturnPct: number | null;
    todayPct: number | null;
    todayChangeAbs: number;
    allocationPct: number;
    /** The accounts holding it, each once, in the order first seen. */
    accounts: string[];
}

export type CombinedPosition<T extends AccountPosition> = Omit<T, keyof SymbolPosition> & SymbolPosition;

/**
 * Combines positions in the same symbol (in any letter case) into one row.
 * Everything that belongs to the symbol rather than the account (name,
 * sector, policy bucket, themes) comes from its first position. Rows come
 * out in the order their symbols first appear.
 */
export function combineBySymbol<T extends AccountPosition>(positions: readonly T[]): Array<CombinedPosition<T>> {
    const bySymbol = new Map<string, T[]>();
    for (const position of positions) {
        const key = position.symbol.toUpperCase();
        const group = bySymbol.get(key);
        if (group) group.push(position);
        else bySymbol.set(key, [position]);
    }
    return [...bySymbol].map(([key, group]) => combineGroup(key, group));
}

function combineGroup<T extends AccountPosition>(key: string, group: readonly T[]): CombinedPosition<T> {
    const quantity = sum(group, (p) => p.quantity);
    const costBasis = sum(group, (p) => p.costBasis);
    const priced = group.filter((p) => p.last !== null);
    const pricedQuantity = sum(priced, (p) => p.quantity);
    const pricedValue = sum(priced, (p) => p.marketValue);
    const pricedCost = sum(priced, (p) => p.costBasis);
    // Every account has the same quote; stored prices (from a broker sync or
    // an import) can differ, and then the price is the one the value implies.
    const prices = new Set(priced.map((p) => p.last));
    const last = priced.length === 0
        ? null
        : prices.size === 1
            ? priced[0].last
            : pricedQuantity !== 0 ? pricedValue / pricedQuantity : null;

    return {
        ...group[0],
        id: `symbol:${key}`,
        quantity,
        avgCost: quantity !== 0 ? costBasis / quantity : 0,
        costBasis,
        marketValue: sum(group, (p) => p.marketValue),
        last,
        partlyAtCost: priced.length > 0 && priced.length < group.length,
        totalReturnPct: priced.length > 0 && pricedCost > 0 ? ((pricedValue - pricedCost) / pricedCost) * 100 : null,
        todayPct: group.find((p) => p.todayPct !== null)?.todayPct ?? null,
        todayChangeAbs: sum(group, (p) => p.todayChangeAbs),
        allocationPct: sum(group, (p) => p.allocationPct),
        accounts: [...new Set(group.map((p) => p.account))],
    };
}

function sum<T>(rows: readonly T[], value: (row: T) => number): number {
    return rows.reduce((total, row) => total + value(row), 0);
}
