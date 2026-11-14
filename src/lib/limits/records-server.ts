/**
 * The per-user record limits of launch item i77 (records.ts), checked inside
 * each write's transaction under a per-user lock, so two requests can't
 * both pass the last place.
 */

import { count, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { journalEntries, portfolios, theses, transactions, watchlistItems } from "@/db/schema";
import { apiError } from "@/lib/api/security";

import { RECORD_LIMITS, recordLimitCode, RecordLimitError, recordLimitMessage, type RecordKind } from "./records";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/** Waits for, then holds to the end of the transaction, the lock on the user's records of `kind`. */
export function buildLockUserRecordsQuery(kind: RecordKind, userId: string, database: Pick<Executor, "execute"> = db) {
    return database.execute(sql`select pg_advisory_xact_lock(hashtext(${`atlas:records:${kind}:${userId}`}))`);
}

const research = { watchlist: watchlistItems, journal: journalEntries, theses } as const;

/** How many of the user's records of `kind` count toward its limit: live ones, never a dismissed row. */
export function buildCountRecordsQuery(kind: RecordKind, userId: string, database: Pick<Executor, "select"> = db) {
    if (kind === "transactions") {
        const own = database.select({ id: portfolios.id }).from(portfolios).where(eq(portfolios.userId, userId));
        return database.select({ n: count() }).from(transactions).where(inArray(transactions.portfolioId, own));
    }
    const table = research[kind];
    return database.select({ n: count() }).from(table).where(sql`${table.userId} = ${userId} and not ${table.dismissed}`);
}

async function countRecords(tx: Transaction, kind: RecordKind, userId: string): Promise<number> {
    const [row] = await buildCountRecordsQuery(kind, userId, tx);
    return row?.n ?? 0;
}

/**
 * Inside `tx`: takes the user's lock for `kind`, runs `write`, and throws
 * RecordLimitError (rolling the write back) when it added records and left
 * the user past the limit. A write that adds none, such as an edit or a
 * removal, always goes through, even for a user already past it.
 */
export async function withinRecordLimit<T>(tx: Transaction, kind: RecordKind, userId: string, write: () => Promise<T>): Promise<T> {
    await buildLockUserRecordsQuery(kind, userId, tx);
    const before = await countRecords(tx, kind, userId);
    const result = await write();
    const after = await countRecords(tx, kind, userId);
    if (after > before && after > RECORD_LIMITS[kind]) throw new RecordLimitError(kind);
    return result;
}

/** The answer to a write a limit refused: 409 with the kind's code and what the user is told. */
export function recordLimitResponse(error: RecordLimitError) {
    return apiError(recordLimitMessage(error.kind), recordLimitCode(error.kind), 409);
}
