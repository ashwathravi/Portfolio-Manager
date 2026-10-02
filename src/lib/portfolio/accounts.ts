/**
 * Portfolio › Accounts — per-account totals derived from the user's
 * portfolios and holdings in the database. Replaces the retired
 * /portfolios page, which rendered three hardcoded accounts worth $1.1M
 * regardless of what the user actually held.
 */

export interface AccountHoldingInput {
    symbol: string;
    quantity: string | number;
    avgCost: string | number;
    currentPrice?: number | null;
    marketValue?: number | null;
}

export interface AccountInput {
    id: string;
    name: string;
    description?: string | null;
    cashBalance?: number | null;
    updatedAt?: Date | string | null;
    holdings: readonly AccountHoldingInput[];
}

export interface AccountRow {
    id: string;
    name: string;
    description: string | null;
    positions: number;
    investedUsd: number;
    cashUsd: number;
    totalUsd: number;
    costBasisUsd: number;
    /** Unrealized gain as a % of cost basis; null when there is no cost basis. */
    unrealizedPct: number | null;
    /** Share of total value across all accounts, 0–100. */
    sharePct: number;
    updatedAt: string | null;
}

export interface AccountsSummary {
    accounts: number;
    positions: number;
    totalUsd: number;
    cashUsd: number;
}

const num = (v: string | number | null | undefined): number => {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Builds account rows. `quotes` (symbol → live price) wins over the cached
 * `currentPrice`, which wins over `marketValue`, which falls back to cost.
 */
export function buildAccountRows(
    accounts: readonly AccountInput[],
    quotes: Readonly<Record<string, number>> = {},
): AccountRow[] {
    const base = accounts.map((a) => {
        let invested = 0;
        let cost = 0;
        for (const h of a.holdings) {
            const qty = num(h.quantity);
            const avg = num(h.avgCost);
            const live = quotes[h.symbol.toUpperCase()];
            const price = live ?? (h.currentPrice ?? null);
            const value = price !== null && price !== undefined ? qty * price : h.marketValue ?? qty * avg;
            invested += value;
            cost += qty * avg;
        }
        const cash = num(a.cashBalance);
        const updated = a.updatedAt ? new Date(a.updatedAt) : null;
        return {
            id: a.id,
            name: a.name,
            description: a.description ?? null,
            positions: a.holdings.length,
            investedUsd: round2(invested),
            cashUsd: round2(cash),
            totalUsd: round2(invested + cash),
            costBasisUsd: round2(cost),
            unrealizedPct: cost > 0 ? Math.round(((invested - cost) / cost) * 1000) / 10 : null,
            sharePct: 0,
            updatedAt: updated && Number.isFinite(updated.getTime()) ? updated.toISOString() : null,
        };
    });
    const grand = base.reduce((s, r) => s + r.totalUsd, 0);
    return base
        .map((r) => ({ ...r, sharePct: grand > 0 ? Math.round((r.totalUsd / grand) * 1000) / 10 : 0 }))
        .sort((a, b) => b.totalUsd - a.totalUsd || a.name.localeCompare(b.name));
}

export function summarizeAccounts(rows: readonly AccountRow[]): AccountsSummary {
    return {
        accounts: rows.length,
        positions: rows.reduce((s, r) => s + r.positions, 0),
        totalUsd: round2(rows.reduce((s, r) => s + r.totalUsd, 0)),
        cashUsd: round2(rows.reduce((s, r) => s + r.cashUsd, 0)),
    };
}
