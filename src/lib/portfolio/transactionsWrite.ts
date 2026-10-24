/**
 * Writing transactions (launch item i40): one entered by hand, a CSV's
 * worth, or deleting one. Every write checks that the account belongs to
 * the user, whose ID the API routes take from the session.
 */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { portfolios, transactions } from "@/db/schema";
import type { TransactionRow } from "@/lib/validators/transaction";

import { contentExternalId, transactionAmount, transactionTimestamp } from "./transactions";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export class AccountNotFoundError extends Error {
    constructor() {
        super("Account not found");
        this.name = "AccountNotFoundError";
    }
}

function toRow(portfolioId: string, row: TransactionRow, source: "manual" | "csv", externalId: string | null) {
    return {
        portfolioId,
        type: row.type,
        symbol: row.symbol ?? null,
        quantity: row.quantity != null ? String(row.quantity) : null,
        price: row.price != null ? String(row.price) : null,
        amount: transactionAmount(row),
        fees: row.fees != null ? String(row.fees) : null,
        currency: row.currency,
        timestamp: transactionTimestamp(row.date),
        notes: row.notes || null,
        source,
        externalId,
    };
}

async function ownedAccount(tx: Executor, userId: string, portfolioId: string): Promise<void> {
    const [owned] = await tx
        .select({ id: portfolios.id })
        .from(portfolios)
        .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
        .limit(1);
    if (!owned) throw new AccountNotFoundError();
}

/** Adds one transaction to one of the user's accounts and returns its ID. */
export async function addTransaction(userId: string, portfolioId: string, row: TransactionRow, database: Database = db): Promise<string> {
    return database.transaction(async (tx) => {
        await ownedAccount(tx, userId, portfolioId);
        const [inserted] = await tx
            .insert(transactions)
            .values(toRow(portfolioId, row, "manual", row.externalId ?? null))
            .returning({ id: transactions.id });
        return inserted.id;
    });
}

/**
 * The external ID each imported row is kept under: the file's own, or one
 * made from the row's contents (see contentExternalId).
 */
export function importExternalIds(rows: readonly TransactionRow[]): string[] {
    const seen = new Map<string, number>();
    return rows.map((row) => {
        if (row.externalId) return `csv:${row.externalId}`;
        const base = contentExternalId(row, 0);
        const occurrence = seen.get(base) ?? 0;
        seen.set(base, occurrence + 1);
        return contentExternalId(row, occurrence);
    });
}

// Postgres takes at most 65,535 bound values a statement; a row has 12.
const ROWS_PER_INSERT = 1000;

export interface TransactionImportResult {
    inserted: number;
    /** Rows the account already had, from an earlier import of the same file. */
    duplicates: number;
}

/**
 * Imports a CSV's transactions into one of the user's accounts. A row the
 * account already has (same external ID) is skipped, so importing a file
 * again, or an export that overlaps an earlier one, adds only what's new.
 */
export async function importTransactions(
    userId: string,
    portfolioId: string,
    rows: readonly TransactionRow[],
    database: Database = db,
): Promise<TransactionImportResult> {
    const ids = importExternalIds(rows);
    return database.transaction(async (tx) => {
        await ownedAccount(tx, userId, portfolioId);
        let inserted = 0;
        for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
            const values = rows.slice(start, start + ROWS_PER_INSERT).map((row, i) => toRow(portfolioId, row, "csv", ids[start + i]));
            const added = await tx.insert(transactions).values(values).onConflictDoNothing().returning({ id: transactions.id });
            inserted += added.length;
        }
        return { inserted, duplicates: rows.length - inserted };
    });
}

export function buildDeleteTransactionQuery(userId: string, id: string, database: Executor = db) {
    const own = database.select({ id: portfolios.id }).from(portfolios).where(eq(portfolios.userId, userId));
    return database
        .delete(transactions)
        .where(and(eq(transactions.id, id), inArray(transactions.portfolioId, own)))
        .returning({ id: transactions.id });
}

/** Deletes one of the user's transactions; false when they have none with that ID. */
export async function deleteTransaction(userId: string, id: string, database: Database = db): Promise<boolean> {
    return (await buildDeleteTransactionQuery(userId, id, database)).length > 0;
}
