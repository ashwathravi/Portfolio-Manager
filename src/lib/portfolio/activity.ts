/**
 * Portfolio › Activity — normalizes transaction rows from the database
 * into display rows and derives the summary strip and filters. Pure so it
 * can be unit tested and shared between the server page and client view.
 */

export type ActivitySide = 'BUY' | 'SELL' | 'DIVIDEND' | 'DEPOSIT' | 'WITHDRAWAL' | 'OTHER';

export interface TransactionRowInput {
    id: string;
    symbol: string | null;
    type: string;
    quantity: string | number | null;
    price: string | number | null;
    amount?: number | null;
    timestamp: Date | string;
    notes?: string | null;
    portfolioName: string;
}

export interface ActivityRow {
    id: string;
    /** ISO timestamp. */
    date: string;
    symbol: string | null;
    side: ActivitySide;
    quantity: number | null;
    price: number | null;
    /** Absolute cash value of the transaction. */
    value: number;
    account: string;
    notes: string | null;
}

export interface ActivitySummary {
    count: number;
    buyCount: number;
    sellCount: number;
    boughtUsd: number;
    soldUsd: number;
    accounts: number;
}

export interface ActivityFilter {
    query?: string;
    side?: 'ALL' | ActivitySide;
    account?: string | 'ALL';
    symbols?: readonly string[] | null;
}

function toNumber(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

export function normalizeSide(type: string): ActivitySide {
    const t = type.trim().toUpperCase();
    if (t === 'BUY' || t === 'SELL' || t === 'DIVIDEND' || t === 'DEPOSIT' || t === 'WITHDRAWAL') return t;
    return 'OTHER';
}

export function toActivityRows(rows: readonly TransactionRowInput[]): ActivityRow[] {
    return rows
        .map((r) => {
            const quantity = toNumber(r.quantity);
            const price = toNumber(r.price);
            const computed = quantity !== null && price !== null ? Math.abs(quantity * price) : null;
            const value = Math.round((computed ?? Math.abs(r.amount ?? 0)) * 100) / 100;
            const ts = r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp);
            return {
                id: r.id,
                date: Number.isFinite(ts.getTime()) ? ts.toISOString() : new Date(0).toISOString(),
                symbol: r.symbol ? r.symbol.toUpperCase() : null,
                side: normalizeSide(r.type),
                quantity,
                price,
                value,
                account: r.portfolioName,
                notes: r.notes ?? null,
            };
        })
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function summarizeActivity(rows: readonly ActivityRow[]): ActivitySummary {
    let buyCount = 0;
    let sellCount = 0;
    let boughtUsd = 0;
    let soldUsd = 0;
    const accounts = new Set<string>();
    for (const r of rows) {
        accounts.add(r.account);
        if (r.side === 'BUY') {
            buyCount += 1;
            boughtUsd += r.value;
        } else if (r.side === 'SELL') {
            sellCount += 1;
            soldUsd += r.value;
        }
    }
    return {
        count: rows.length,
        buyCount,
        sellCount,
        boughtUsd: Math.round(boughtUsd * 100) / 100,
        soldUsd: Math.round(soldUsd * 100) / 100,
        accounts: accounts.size,
    };
}

export function filterActivity(rows: readonly ActivityRow[], filter: ActivityFilter): ActivityRow[] {
    const q = filter.query?.trim().toUpperCase() ?? '';
    const symbolSet = filter.symbols ? new Set(filter.symbols.map((s) => s.toUpperCase())) : null;
    return rows.filter((r) => {
        if (filter.side && filter.side !== 'ALL' && r.side !== filter.side) return false;
        if (filter.account && filter.account !== 'ALL' && r.account !== filter.account) return false;
        if (symbolSet && (!r.symbol || !symbolSet.has(r.symbol))) return false;
        if (q && !(r.symbol ?? '').includes(q) && !r.account.toUpperCase().includes(q) && !(r.notes ?? '').toUpperCase().includes(q)) {
            return false;
        }
        return true;
    });
}

/** Distinct account names, alphabetically. */
export function activityAccounts(rows: readonly ActivityRow[]): string[] {
    return [...new Set(rows.map((r) => r.account))].sort((a, b) => a.localeCompare(b));
}
