/**
 * The theses, thesis_catalysts and thesis_evidence tables (launch item
 * i38). Every query is scoped to one user's ID, which the API routes take
 * from the session.
 *
 * A thesis is saved whole: its row, then its catalysts and evidence
 * replaced in the same transaction. As for the watchlist and journal, a
 * deleted thesis stays as a `dismissed` row with its text cleared (and no
 * catalysts or evidence), and a save from a page is ignored if the thesis
 * already has a later one from that page.
 */

import { and, asc, desc, eq, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { theses, thesisCatalysts, thesisEvidence } from "@/db/schema";
import type { WriteOrder } from "@/lib/validators/research-ids";
import type { ThesisInput } from "@/lib/validators/thesis";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export interface StoredTheses {
    theses: ThesisInput[];
    /** Theses the user deleted, examples included. */
    dismissed: string[];
}

export function buildListThesesQuery(userId: string, database: Executor = db) {
    return database
        .select()
        .from(theses)
        .where(eq(theses.userId, userId))
        .orderBy(desc(theses.createdAt), asc(theses.id));
}

export function buildListCatalystsQuery(userId: string, database: Executor = db) {
    return database
        .select()
        .from(thesisCatalysts)
        .where(eq(thesisCatalysts.userId, userId))
        .orderBy(asc(thesisCatalysts.thesisId), asc(thesisCatalysts.position));
}

export function buildListEvidenceQuery(userId: string, database: Executor = db) {
    return database
        .select()
        .from(thesisEvidence)
        .where(eq(thesisEvidence.userId, userId))
        .orderBy(asc(thesisEvidence.thesisId), asc(thesisEvidence.position));
}

export async function loadTheses(userId: string, database: Database = db): Promise<StoredTheses> {
    const [rows, catalysts, evidence] = await Promise.all([
        buildListThesesQuery(userId, database),
        buildListCatalystsQuery(userId, database),
        buildListEvidenceQuery(userId, database),
    ]);
    const catalystsOf = new Map<string, ThesisInput["catalysts"]>();
    for (const c of catalysts) {
        const list = catalystsOf.get(c.thesisId) ?? [];
        list.push({ id: c.id, title: c.title, date: c.date, impact: c.impact as ThesisInput["catalysts"][number]["impact"] });
        catalystsOf.set(c.thesisId, list);
    }
    const evidenceOf = new Map<string, ThesisInput["linkedEvidence"]>();
    for (const e of evidence) {
        const list = evidenceOf.get(e.thesisId) ?? [];
        list.push({ id: e.id, title: e.title, type: e.type as ThesisInput["linkedEvidence"][number]["type"], date: e.date, url: e.url });
        evidenceOf.set(e.thesisId, list);
    }
    return {
        theses: rows.filter((row) => !row.dismissed).map((row) => ({
            id: row.id,
            ticker: row.ticker,
            companyName: row.companyName,
            title: row.title,
            description: row.description,
            type: row.type as ThesisInput["type"],
            status: row.status as ThesisInput["status"],
            conviction: row.conviction as ThesisInput["conviction"],
            targetPrice: row.targetPrice,
            currentPrice: row.currentPrice,
            timeHorizon: row.timeHorizon,
            dateCreated: row.dateCreated,
            dateUpdated: row.dateUpdated,
            tags: row.tags,
            hypothesis: row.hypothesis,
            bullCase: row.bullCase,
            bearCase: row.bearCase,
            catalysts: catalystsOf.get(row.id) ?? [],
            linkedEvidence: evidenceOf.get(row.id) ?? [],
            healthScore: row.healthScore,
            dismissed: false,
        })),
        dismissed: rows.filter((row) => row.dismissed).map((row) => row.id),
    };
}

/** The row for `thesis`. A deleted thesis keeps only what identifies it: its text is cleared. */
function toRow(userId: string, thesis: ThesisInput, now: Date, order: WriteOrder | null) {
    const removed = thesis.dismissed;
    return {
        userId,
        id: thesis.id,
        ticker: thesis.ticker,
        companyName: removed ? "" : thesis.companyName,
        title: removed ? "" : thesis.title,
        description: removed ? "" : thesis.description,
        type: thesis.type,
        status: thesis.status,
        conviction: thesis.conviction,
        targetPrice: removed ? 0 : thesis.targetPrice,
        currentPrice: removed ? null : thesis.currentPrice,
        timeHorizon: removed ? "" : thesis.timeHorizon,
        dateCreated: thesis.dateCreated,
        dateUpdated: thesis.dateUpdated,
        tags: removed ? [] : thesis.tags,
        hypothesis: removed ? "" : thesis.hypothesis,
        bullCase: removed ? [] : thesis.bullCase,
        bearCase: removed ? [] : thesis.bearCase,
        healthScore: thesis.healthScore,
        dismissed: removed,
        writeSession: order?.session ?? null,
        writeSeq: order?.seq ?? null,
        updatedAt: now,
    };
}

function catalystRows(userId: string, thesis: ThesisInput) {
    if (thesis.dismissed) return [];
    return thesis.catalysts.map((c, position) => ({ userId, thesisId: thesis.id, id: c.id, position, title: c.title, date: c.date, impact: c.impact }));
}

function evidenceRows(userId: string, thesis: ThesisInput) {
    if (thesis.dismissed) return [];
    return thesis.linkedEvidence.map((e, position) => ({
        userId, thesisId: thesis.id, id: e.id, position, title: e.title, type: e.type, date: e.date, url: e.url,
    }));
}

/**
 * Whether a write in `order` may replace the row: always, unless the row's
 * last write came from the same page and was this one or a later one.
 */
function isNewerThanRow(order: WriteOrder) {
    return or(
        sql`${theses.writeSession} is distinct from ${order.session}`,
        sql`${theses.writeSeq} < ${order.seq}`,
    );
}

/** Adds the thesis row or replaces the user's row with that ID, unless it has a later write from the same page. */
export function buildSaveThesisQuery(userId: string, thesis: ThesisInput, order: WriteOrder, now: Date, database: Executor = db) {
    const row = toRow(userId, thesis, now, order);
    // Everything but the key.
    const set: Partial<typeof row> = { ...row };
    delete set.userId;
    delete set.id;
    return database
        .insert(theses)
        .values({ ...row, createdAt: now })
        .onConflictDoUpdate({
            target: [theses.userId, theses.id],
            set,
            setWhere: isNewerThanRow(order),
        })
        .returning({ id: theses.id });
}

/**
 * Saves one thesis with its catalysts and evidence, in one transaction.
 * Returns false when the write was older than the thesis's last one from
 * the same page, and so changed nothing.
 */
export async function saveThesis(
    userId: string,
    thesis: ThesisInput,
    order: WriteOrder,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<boolean> {
    return database.transaction(async (tx) => {
        const saved = await buildSaveThesisQuery(userId, thesis, order, now, tx);
        if (saved.length === 0) return false;
        const ofThesis = (table: typeof thesisCatalysts | typeof thesisEvidence) =>
            and(eq(table.userId, userId), eq(table.thesisId, thesis.id));
        await tx.delete(thesisCatalysts).where(ofThesis(thesisCatalysts));
        await tx.delete(thesisEvidence).where(ofThesis(thesisEvidence));
        const catalysts = catalystRows(userId, thesis);
        const evidence = evidenceRows(userId, thesis);
        if (catalysts.length > 0) await tx.insert(thesisCatalysts).values(catalysts);
        if (evidence.length > 0) await tx.insert(thesisEvidence).values(evidence);
        return true;
    });
}

/**
 * The one-time move of a browser's theses. Theses the account already has
 * (by ID) are left as they are, with their catalysts and evidence, so it is
 * safe to run again. Rows are created a millisecond apart, counting from
 * when the move began and the batch's place in the list, so the list keeps
 * the browser's order across batches. A start in the future counts as now.
 */
export function buildImportThesesQuery(
    userId: string,
    { items, first = 0, startedAt }: { items: readonly ThesisInput[]; first?: number; startedAt?: number },
    now: Date,
    database: Executor = db,
) {
    const base = Math.min(startedAt ?? now.getTime(), now.getTime());
    return database
        .insert(theses)
        .values(items.map((thesis, index) => ({ ...toRow(userId, thesis, now, null), createdAt: new Date(base - first - index) })))
        .onConflictDoNothing()
        .returning({ id: theses.id });
}

export async function importTheses(
    userId: string,
    batch: { items: readonly ThesisInput[]; first?: number; startedAt?: number },
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<void> {
    if (batch.items.length === 0) return;
    await database.transaction(async (tx) => {
        const inserted = new Set((await buildImportThesesQuery(userId, batch, now, tx)).map((row) => row.id));
        const added = batch.items.filter((thesis) => inserted.has(thesis.id));
        const catalysts = added.flatMap((thesis) => catalystRows(userId, thesis));
        const evidence = added.flatMap((thesis) => evidenceRows(userId, thesis));
        if (catalysts.length > 0) await tx.insert(thesisCatalysts).values(catalysts);
        if (evidence.length > 0) await tx.insert(thesisEvidence).values(evidence);
    });
}
