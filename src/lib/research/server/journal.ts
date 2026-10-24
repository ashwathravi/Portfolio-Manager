/**
 * The journal_entries table (launch item i38). Every query is scoped to one
 * user's ID, which the API routes take from the session.
 *
 * As with the watchlist, entries are never deleted on request: a deleted
 * entry is kept as `dismissed` with its text cleared, so a save from the
 * same page that arrives after the deletion can't bring it back. They go
 * when the account does.
 */

import { asc, desc, eq, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import type { JournalEntryInput } from "@/lib/validators/journal";
import type { WriteOrder } from "@/lib/validators/research-ids";

type Database = typeof db;

export interface StoredJournal {
    entries: JournalEntryInput[];
    /** Example entries the user deleted. */
    dismissed: string[];
}

export function buildListJournalQuery(userId: string, database: Database = db) {
    return database
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.userId, userId))
        .orderBy(desc(journalEntries.date), desc(journalEntries.createdAt), asc(journalEntries.id));
}

export async function loadJournal(userId: string, database: Database = db): Promise<StoredJournal> {
    const rows = await buildListJournalQuery(userId, database);
    return {
        entries: rows.filter((row) => !row.dismissed).map(toEntry),
        dismissed: rows.filter((row) => row.dismissed).map((row) => row.id),
    };
}

function toEntry(row: typeof journalEntries.$inferSelect): JournalEntryInput {
    return {
        id: row.id,
        date: row.date,
        type: row.type as JournalEntryInput["type"],
        ticker: row.ticker,
        decision: row.decision,
        rationale: row.rationale,
        outcome: row.outcome as JournalEntryInput["outcome"],
        thesisId: row.thesisId,
        dismissed: row.dismissed,
    };
}

/** The row for `entry`. A deleted entry keeps only what identifies it: its text is cleared. */
function toRow(userId: string, entry: JournalEntryInput, now: Date, order: WriteOrder | null) {
    const removed = entry.dismissed;
    return {
        userId,
        id: entry.id,
        date: entry.date,
        type: entry.type,
        ticker: entry.ticker,
        decision: removed ? "" : entry.decision,
        rationale: removed ? "" : entry.rationale,
        outcome: entry.outcome,
        thesisId: removed ? null : entry.thesisId,
        dismissed: entry.dismissed,
        writeSession: order?.session ?? null,
        writeSeq: order?.seq ?? null,
        updatedAt: now,
    };
}

/**
 * Whether a write in `order` may replace the row: always, unless the row's
 * last write came from the same page and was this one or a later one.
 */
function isNewerThanRow(order: WriteOrder) {
    return or(
        sql`${journalEntries.writeSession} is distinct from ${order.session}`,
        sql`${journalEntries.writeSeq} < ${order.seq}`,
    );
}

/** Adds the entry or replaces the user's entry with that ID, unless it has a later write from the same page. */
export function buildSaveJournalEntryQuery(userId: string, entry: JournalEntryInput, order: WriteOrder, now: Date, database: Database = db) {
    const row = toRow(userId, entry, now, order);
    return database
        .insert(journalEntries)
        .values({ ...row, createdAt: now })
        .onConflictDoUpdate({
            target: [journalEntries.userId, journalEntries.id],
            set: {
                date: row.date,
                type: row.type,
                ticker: row.ticker,
                decision: row.decision,
                rationale: row.rationale,
                outcome: row.outcome,
                thesisId: row.thesisId,
                dismissed: row.dismissed,
                writeSession: row.writeSession,
                writeSeq: row.writeSeq,
                updatedAt: now,
            },
            setWhere: isNewerThanRow(order),
        });
}

export async function saveJournalEntry(
    userId: string,
    entry: JournalEntryInput,
    order: WriteOrder,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<void> {
    await buildSaveJournalEntryQuery(userId, entry, order, now, database);
}

/**
 * The one-time move of a browser's journal. Entries the account already has
 * (by ID) are left as they are, so it is safe to run again, from this
 * browser or another. Entries are created a millisecond apart, counting from
 * when the move began and the batch's place in the journal, so entries on
 * the same date keep the browser's order across batches. A start in the
 * future counts as now.
 */
export function buildImportJournalQuery(
    userId: string,
    { items, first = 0, startedAt }: { items: readonly JournalEntryInput[]; first?: number; startedAt?: number },
    now: Date,
    database: Database = db,
) {
    const base = Math.min(startedAt ?? now.getTime(), now.getTime());
    return database
        .insert(journalEntries)
        .values(items.map((entry, index) => ({ ...toRow(userId, entry, now, null), createdAt: new Date(base - first - index) })))
        .onConflictDoNothing();
}

export async function importJournal(
    userId: string,
    batch: { items: readonly JournalEntryInput[]; first?: number; startedAt?: number },
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<void> {
    if (batch.items.length === 0) return;
    await buildImportJournalQuery(userId, batch, now, database);
}
