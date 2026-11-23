/**
 * Other assets and debts (net_worth_items in schema.ts): reading the user's
 * for Accounts and Today, and the user's own adds, edits and deletes. Every
 * query is scoped to the user's ID: another user's item reads as not found.
 * Each save also keeps the value as of its day (net_worth_item_values).
 *
 * No account lock and no account touched: no account, valuation or return
 * reads these rows (net-worth.ts).
 */

import { and, asc, desc, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { isDatabaseConfigured } from "@/db/connection-options";
import { netWorthItemValues, netWorthItems } from "@/db/schema";
import { withinRecordLimit } from "@/lib/limits/records-server";
import { loggableError } from "@/lib/observability/loggable-error";
import type { NetWorthItemInput } from "@/lib/validators/net-worth-item";
import type { NetWorthCategory, NetWorthItemRow, NetWorthItemsRead, NetWorthKind } from "./net-worth";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The user's items: assets first, then the largest value first. */
export function buildUserNetWorthItemsQuery(userId: string, database: Pick<Database, "select"> = db) {
    return database
        .select({
            id: netWorthItems.id,
            kind: netWorthItems.kind,
            category: netWorthItems.category,
            name: netWorthItems.name,
            value: netWorthItems.value,
            valueAsOf: netWorthItems.valueAsOf,
            note: netWorthItems.note,
            updatedAt: netWorthItems.updatedAt,
        })
        .from(netWorthItems)
        .where(eq(netWorthItems.userId, userId))
        .orderBy(asc(netWorthItems.kind), desc(netWorthItems.value), asc(netWorthItems.name), asc(netWorthItems.id));
}

export async function loadNetWorthItems(userId: string, database: Database = db): Promise<NetWorthItemRow[]> {
    const rows = await buildUserNetWorthItemsQuery(userId, database);
    return rows.map((r) => ({
        ...r,
        // The table's checks hold both to the lists in net-worth.ts.
        kind: r.kind as NetWorthKind,
        category: r.category as NetWorthCategory,
        value: Number(r.value),
        updatedAt: r.updatedAt.toISOString(),
    }));
}

/**
 * The user's items for a page (Today, Accounts), read with `query`
 * (loadNetWorthItems). "unavailable" when the database fails to answer, so
 * the page says they couldn't be loaded instead of leaving them out
 * unannounced; null without a database, which has nowhere to keep them.
 */
export async function readNetWorthItemsForPage(
    userId: string,
    query: (userId: string) => Promise<NetWorthItemRow[]>,
    { page, databaseConfigured = isDatabaseConfigured() }: { page: string; databaseConfigured?: boolean },
): Promise<NetWorthItemsRead> {
    if (!databaseConfigured) return null;
    try {
        return await query(userId);
    } catch (error) {
        console.warn(`${page}: other assets and debts fetch failed — the page says they couldn't be loaded.`, loggableError(error));
        return "unavailable";
    }
}

/**
 * An edit that would turn an asset into a debt, or a debt into an asset.
 * The values kept by day have no kind of their own, so the item's earlier
 * values would then read as the other kind's: a home's value as a debt.
 * Deleting it and adding the other kind starts a history of its own.
 */
export class NetWorthKindChangeError extends Error {
    constructor(readonly kind: NetWorthKind) {
        super(kind === "asset"
            ? "An asset can't become a debt. Delete it and add it as a debt."
            : "A debt can't become an asset. Delete it and add it as an asset.");
        this.name = "NetWorthKindChangeError";
    }
}

function columns(input: NetWorthItemInput) {
    return {
        kind: input.kind,
        category: input.category,
        name: input.name,
        value: String(input.value),
        valueAsOf: input.valueAsOf,
        note: input.note,
    };
}

/**
 * Keeps the item's value as of its day, replacing one kept for that day. It
 * stands from that day on: values kept for later days are removed, so the
 * history never goes back to them after an earlier-dated save (as
 * recordManualValue does for a holding valued by hand).
 */
async function recordValue(tx: Executor, netWorthItemId: string, { valueAsOf, value }: { valueAsOf: string; value: string }, now: Date) {
    await tx
        .delete(netWorthItemValues)
        .where(and(eq(netWorthItemValues.netWorthItemId, netWorthItemId), gt(netWorthItemValues.date, valueAsOf)));
    await tx
        .insert(netWorthItemValues)
        .values({ netWorthItemId, date: valueAsOf, value, recordedAt: now })
        .onConflictDoUpdate({
            target: [netWorthItemValues.netWorthItemId, netWorthItemValues.date],
            set: { value: sql`excluded.value`, recordedAt: sql`excluded.recorded_at` },
        });
}

/**
 * Adds an item and keeps its first value. Refused with RecordLimitError, and
 * nothing added, when the user already has RECORD_LIMITS.netWorthItems
 * (launch item i77).
 */
export async function addNetWorthItem(
    userId: string,
    input: NetWorthItemInput,
    { database = db, now = new Date() }: { database?: Database; now?: Date } = {},
): Promise<string> {
    return database.transaction((tx) => withinRecordLimit(tx, "netWorthItems", userId, async () => {
        const saved = columns(input);
        const [inserted] = await tx
            .insert(netWorthItems)
            .values({ userId, ...saved, createdAt: now, updatedAt: now })
            .returning({ id: netWorthItems.id });
        await recordValue(tx, inserted.id, saved, now);
        return inserted.id;
    }));
}

/**
 * Saves the item as the form now has it, its category included, and keeps
 * the value as of its day. False when the user has no item with that ID,
 * whatever the kind sent, so another user's item gives nothing away.
 * Refused with NetWorthKindChangeError, and nothing saved, when it would
 * change the item's kind. Never refused by the limit: it adds nothing.
 */
export async function updateNetWorthItem(
    userId: string,
    id: string,
    input: NetWorthItemInput,
    { database = db, now = new Date() }: { database?: Database; now?: Date } = {},
): Promise<boolean> {
    return database.transaction(async (tx) => {
        const mine = and(eq(netWorthItems.id, id), eq(netWorthItems.userId, userId));
        // Locked until the save ends, so a deletion at the same time waits
        // instead of removing the item before its value is saved (a 500).
        const [stored] = await tx.select({ kind: netWorthItems.kind }).from(netWorthItems).where(mine).for("update");
        if (!stored) return false;
        if (stored.kind !== input.kind) throw new NetWorthKindChangeError(stored.kind as NetWorthKind);
        const saved = columns(input);
        await tx.update(netWorthItems).set({ ...saved, updatedAt: now }).where(mine);
        await recordValue(tx, id, saved, now);
        return true;
    });
}

/** Deletes the item and its values. False when the user has no item with that ID. */
export async function deleteNetWorthItem(userId: string, id: string, { database = db }: { database?: Database } = {}): Promise<boolean> {
    const deleted = await database
        .delete(netWorthItems)
        .where(and(eq(netWorthItems.id, id), eq(netWorthItems.userId, userId)))
        .returning({ id: netWorthItems.id });
    return deleted.length > 0;
}
