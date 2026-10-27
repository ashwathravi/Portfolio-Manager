/**
 * The account export (launch item i65): what GET /api/account/export answers,
 * and its holdings and transactions as CSV rows. Browser-safe: the
 * Settings card builds the CSV files from the same export.
 */

import type { Order } from "@/types/execution";

export const ACCOUNT_EXPORT_FORMAT = "atlas-wealth-export";
export const ACCOUNT_EXPORT_VERSION = 1;

export interface ExportedHolding {
    symbol: string;
    name: string;
    quantity: number;
    avgCost: number;
    /** The last price stored with it; null before the first. */
    lastPrice: number | null;
    updatedAt: string;
}

export interface ExportedTransaction {
    /** ISO timestamp (noon UTC on the trade date). */
    date: string;
    type: string;
    symbol: string | null;
    quantity: number | null;
    price: number | null;
    amount: number | null;
    fees: number | null;
    currency: string;
    notes: string | null;
    /** "manual", "csv" or "plaid". */
    source: string;
}

export interface ExportedValuation {
    date: string;
    totalValue: number;
    holdingsValue: number;
    cash: number;
    costBasis: number;
    /** What was held that day and what each was valued at. */
    positions: ExportedValuationPosition[];
}

export interface ExportedValuationPosition {
    symbol: string;
    quantity: number;
    costBasis: number;
    /** Null when it had no price; otherwise the close it was valued at, and that close's date. */
    close: number | null;
    closeDate: string | null;
    marketValue: number | null;
}

/** An order plan drafted on Trade, as the blotter shows it (src/types/execution.ts). */
export type ExportedOrderPlan = Order;

export interface ExportedAccount {
    id: string;
    name: string;
    description: string | null;
    /** "manual" or "plaid". */
    source: string;
    cashBalance: number;
    createdAt: string;
    updatedAt: string;
    holdings: ExportedHolding[];
    transactions: ExportedTransaction[];
    valuationHistory: ExportedValuation[];
    /** Oldest first. */
    orderPlans: ExportedOrderPlan[];
}

export interface ExportedConnection {
    institutionName: string | null;
    status: string;
    linkedAt: string;
    accounts: { name: string; mask: string | null; type: string; subtype: string; syncing: boolean }[];
}

export interface AccountExport {
    format: typeof ACCOUNT_EXPORT_FORMAT;
    version: typeof ACCOUNT_EXPORT_VERSION;
    exportedAt: string;
    profile: { name: string | null; email: string | null };
    settings: { version: number; settings: unknown; updatedAt: string } | null;
    accounts: ExportedAccount[];
    linkedConnections: ExportedConnection[];
    watchlist: Record<string, unknown>[];
    journal: Record<string, unknown>[];
    theses: Record<string, unknown>[];
}

/** One row per holding, across the user's accounts. */
export function holdingsCsvRows(data: AccountExport): Record<string, unknown>[] {
    return data.accounts.flatMap((account) => account.holdings.map((h) => ({
        account: account.name,
        symbol: h.symbol,
        name: h.name,
        quantity: h.quantity,
        avg_cost: h.avgCost,
        cost_basis: Math.round(h.quantity * h.avgCost * 100) / 100,
        last_price: h.lastPrice ?? "",
    })));
}

/** One row per transaction, across the user's accounts, oldest first. */
export function transactionsCsvRows(data: AccountExport): Record<string, unknown>[] {
    return data.accounts
        .flatMap((account) => account.transactions.map((t) => ({ account: account.name, ...t })))
        .sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account))
        .map((t) => ({
            account: t.account,
            date: t.date.slice(0, 10),
            type: t.type,
            symbol: t.symbol ?? "",
            quantity: t.quantity ?? "",
            price: t.price ?? "",
            amount: t.amount ?? "",
            fees: t.fees ?? "",
            currency: t.currency,
            notes: t.notes ?? "",
            source: t.source,
        }));
}
