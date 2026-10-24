/**
 * The watchlist_items table (launch item i38). Every query is scoped to one
 * user's ID, which the API routes take from the session.
 */

import { and, asc, desc, eq, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { watchlistItems } from "@/db/schema";
import type { WatchItemInput, WatchWriteOrder } from "@/lib/validators/watchlist";

type Database = typeof db;

export interface StoredWatchlist {
    items: WatchItemInput[];
    /** Example rows the user removed. */
    dismissed: string[];
}

export function buildListWatchlistQuery(userId: string, database: Database = db) {
    return database
        .select()
        .from(watchlistItems)
        .where(eq(watchlistItems.userId, userId))
        .orderBy(desc(watchlistItems.createdAt), asc(watchlistItems.id));
}

export async function loadWatchlist(userId: string, database: Database = db): Promise<StoredWatchlist> {
    const rows = await buildListWatchlistQuery(userId, database);
    return {
        items: rows.filter((row) => !row.dismissed).map(toItem),
        dismissed: rows.filter((row) => row.dismissed).map((row) => row.id),
    };
}

function toItem(row: typeof watchlistItems.$inferSelect): WatchItemInput {
    return {
        id: row.id,
        ticker: row.ticker,
        companyName: row.companyName,
        reason: row.reason,
        notes: row.notes,
        targetEntry: row.targetEntry,
        addedAt: row.addedAt,
        dismissed: row.dismissed,
    };
}

function toRow(userId: string, item: WatchItemInput, now: Date, order: WatchWriteOrder | null) {
    return {
        userId,
        id: item.id,
        ticker: item.ticker,
        companyName: item.companyName,
        reason: item.reason,
        notes: item.notes,
        targetEntry: item.targetEntry,
        addedAt: item.addedAt,
        dismissed: item.dismissed,
        writeSession: order?.session ?? null,
        writeSeq: order?.seq ?? null,
        updatedAt: now,
    };
}

/**
 * Whether a write in `order` may replace the row: always, unless the row's
 * last write came from the same page and was this one or a later one.
 */
function isNewerThanRow(order: WatchWriteOrder) {
    return or(
        sql`${watchlistItems.writeSession} is distinct from ${order.session}`,
        sql`${watchlistItems.writeSeq} < ${order.seq}`,
    );
}

/** Adds the item or replaces the user's row with that ID, unless the row has a later write from the same page. */
export function buildSaveWatchItemQuery(userId: string, item: WatchItemInput, order: WatchWriteOrder, now: Date, database: Database = db) {
    const row = toRow(userId, item, now, order);
    return database
        .insert(watchlistItems)
        .values({ ...row, createdAt: now })
        .onConflictDoUpdate({
            target: [watchlistItems.userId, watchlistItems.id],
            set: {
                ticker: row.ticker,
                companyName: row.companyName,
                reason: row.reason,
                notes: row.notes,
                targetEntry: row.targetEntry,
                addedAt: row.addedAt,
                dismissed: row.dismissed,
                writeSession: row.writeSession,
                writeSeq: row.writeSeq,
                updatedAt: now,
            },
            setWhere: isNewerThanRow(order),
        });
}

export class DuplicateTickerError extends Error {
    constructor(readonly ticker: string) {
        super(`${ticker} is already on the watchlist`);
    }
}

/** Saves one item. Throws DuplicateTickerError when another live row has its ticker. */
export async function saveWatchItem(
    userId: string,
    item: WatchItemInput,
    order: WatchWriteOrder,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<void> {
    try {
        await buildSaveWatchItemQuery(userId, item, order, now, database);
    } catch (error) {
        if (isUniqueViolation(error, "watchlist_items_user_ticker_idx")) throw new DuplicateTickerError(item.ticker);
        throw error;
    }
}

/** Removes the user's row with that ID, unless it has a later write from the same page. */
export function buildDeleteWatchItemQuery(userId: string, id: string, order: WatchWriteOrder, database: Database = db) {
    return database
        .delete(watchlistItems)
        .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.id, id), isNewerThanRow(order)));
}

export async function deleteWatchItem(userId: string, id: string, order: WatchWriteOrder, database: Database = db): Promise<void> {
    await buildDeleteWatchItemQuery(userId, id, order, database);
}

/**
 * The one-time move of a browser's list, in its order. Rows the server
 * already has (by ID, or a live row with the same ticker) are left as they
 * are, so it is safe to run again, from this browser or another.
 */
export function buildImportWatchlistQuery(userId: string, items: readonly WatchItemInput[], now: Date, database: Database = db) {
    return database
        .insert(watchlistItems)
        // A millisecond apart, so the list keeps the browser's order (newest first).
        .values(items.map((item, index) => ({ ...toRow(userId, item, now, null), createdAt: new Date(now.getTime() - index) })))
        .onConflictDoNothing();
}

export async function importWatchlist(
    userId: string,
    items: readonly WatchItemInput[],
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<void> {
    if (items.length === 0) return;
    await buildImportWatchlistQuery(userId, items, now, database);
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
    for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
        const candidate = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
        if (candidate.code === "23505") {
            return candidate.constraint_name === constraint || candidate.constraint === constraint;
        }
    }
    return false;
}
