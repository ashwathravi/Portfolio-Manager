/**
 * Holdings valued by hand (manual_holdings in schema.ts): reading them for
 * an account's value, the user's own adds, edits and deletes, and the rows
 * of a positions file with no ticker (importManualRows). Every query is
 * scoped to the user's ID: another user's holding or account reads as not
 * found.
 */

import { and, asc, eq, gt, isNull, like, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { manualHoldingValues, manualHoldings, portfolios } from "@/db/schema";
import { withinRecordLimit } from "@/lib/limits/records-server";
import type { ManualHoldingInput } from "@/lib/validators/manual-holding";
import { planManualImport, type ManualImportRow, type ManualPlanSummary } from "./csvImport";
import { buildLockUserAccountsQuery } from "./manage";
import { AccountNotFoundError } from "./transactionsWrite";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export interface ManualHolding {
    id: string;
    portfolioId: string;
    name: string;
    identifier: string | null;
    quantity: number | null;
    value: number;
    costBasis: number | null;
    valueAsOf: string;
    source: string;
    /** Its key from a positions file (manualImportKey), so the page can preview the next import; never a linked account's key. */
    importKey: string | null;
    /**
     * Whether a positions file may update it (importManualRows): one added
     * by hand or by a file, or one its own account's syncs brought in, which
     * a file reaches only once that account no longer syncs (a linked
     * account that still syncs refuses the file's rows). Never one keyed by
     * another account's syncs: moved from a linked account, its key keeps
     * that account's sync from adding it again.
     */
    importable: boolean;
}

/** The prefix of a key a positions file gave a holding (manualImportKey). */
const IMPORT_KEY_PREFIX = "csv:";

/** The start of the keys a sync gives the holdings it brings into an account (institutionValuedKey in sync.ts). */
const syncKeyPrefix = (portfolioId: string) => `${portfolioId}:`;

const num = (v: string | null): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

export function buildUserManualHoldingsQuery(userId: string, database: Pick<Database, "select"> = db) {
    return database
        .select({
            id: manualHoldings.id,
            portfolioId: manualHoldings.portfolioId,
            name: manualHoldings.name,
            identifier: manualHoldings.identifier,
            quantity: manualHoldings.quantity,
            value: manualHoldings.value,
            costBasis: manualHoldings.costBasis,
            valueAsOf: manualHoldings.valueAsOf,
            source: manualHoldings.source,
            externalId: manualHoldings.externalId,
        })
        .from(manualHoldings)
        .where(eq(manualHoldings.userId, userId))
        .orderBy(asc(manualHoldings.name), asc(manualHoldings.id));
}

/** The user's holdings valued by hand, across their accounts. */
export async function loadManualHoldings(userId: string, database: Database = db): Promise<ManualHolding[]> {
    const rows = await buildUserManualHoldingsQuery(userId, database);
    return rows.map(({ externalId, ...r }) => ({
        ...r,
        quantity: num(r.quantity),
        value: num(r.value) ?? 0,
        costBasis: num(r.costBasis),
        importKey: externalId?.startsWith(IMPORT_KEY_PREFIX) ? externalId : null,
        importable: externalId === null || externalId.startsWith(IMPORT_KEY_PREFIX) || externalId.startsWith(syncKeyPrefix(r.portfolioId)),
    }));
}

/** Each account's holdings valued by hand: their value and cost (cost counted as the value when not given). */
export function manualTotalsByPortfolio(rows: readonly Pick<ManualHolding, "portfolioId" | "value" | "costBasis">[]): Map<string, { value: number; cost: number }> {
    const totals = new Map<string, { value: number; cost: number }>();
    for (const r of rows) {
        const t = totals.get(r.portfolioId) ?? { value: 0, cost: 0 };
        t.value += r.value;
        t.cost += r.costBasis ?? r.value;
        totals.set(r.portfolioId, t);
    }
    return totals;
}

async function ownedAccount(tx: Executor, userId: string, portfolioId: string): Promise<void> {
    const [owned] = await tx
        .select({ id: portfolios.id })
        .from(portfolios)
        .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
        .limit(1);
    if (!owned) throw new AccountNotFoundError();
}

function values(input: ManualHoldingInput) {
    return {
        name: input.name,
        identifier: input.identifier,
        quantity: input.quantity == null ? null : String(input.quantity),
        value: String(input.value),
        costBasis: input.costBasis == null ? null : String(input.costBasis),
        valueAsOf: input.valueAsOf,
    };
}

/**
 * Records a holding's value as of its day (manual_holding_values), replacing
 * one already recorded for that day. The user's own value stands from its
 * day on (`fromThenOn`): values recorded for later days, a sync's, are
 * dropped, so the history doesn't go back to them after the user's edit.
 */
export async function recordManualValue(
    tx: Executor,
    manualHoldingId: string,
    { date, value, quantity }: { date: string; value: string; quantity: string | null },
    { fromThenOn = false, now = new Date() }: { fromThenOn?: boolean; now?: Date } = {},
): Promise<void> {
    if (fromThenOn) {
        await tx
            .delete(manualHoldingValues)
            .where(and(eq(manualHoldingValues.manualHoldingId, manualHoldingId), gt(manualHoldingValues.date, date)));
    }
    await tx
        .insert(manualHoldingValues)
        .values({ manualHoldingId, date, value, quantity, recordedAt: now })
        .onConflictDoUpdate({
            target: [manualHoldingValues.manualHoldingId, manualHoldingValues.date],
            set: { value: sql`excluded.value`, quantity: sql`excluded.quantity`, recordedAt: sql`excluded.recorded_at` },
        });
}

/**
 * The account's last change moves with it: the nightly valuation takes the
 * newest of an account's changes as the day its history may be rewritten from.
 */
async function touchAccount(tx: Executor, portfolioId: string, now: Date) {
    await tx.update(portfolios).set({ updatedAt: now }).where(eq(portfolios.id, portfolioId));
}

/**
 * Adds the user's holding, up to their limit of holdings valued by hand
 * (RecordLimitError past it, with nothing written).
 */
export async function addManualHolding(
    userId: string,
    portfolioId: string,
    input: ManualHoldingInput,
    { database = db, now = new Date() }: { database?: Database; now?: Date } = {},
): Promise<string> {
    return database.transaction(async (tx) => {
        // A Plaid sync writes an account's synced holdings under this lock:
        // an edit waits for it, so neither overwrites the other.
        await buildLockUserAccountsQuery(userId, tx);
        await ownedAccount(tx, userId, portfolioId);
        const [inserted] = await withinRecordLimit(tx, "manualHoldings", userId, () => tx
            .insert(manualHoldings)
            .values({ userId, portfolioId, ...values(input), source: "manual", createdAt: now, updatedAt: now })
            .returning({ id: manualHoldings.id }));
        const saved = values(input);
        await recordManualValue(tx, inserted.id, { date: saved.valueAsOf, value: saved.value, quantity: saved.quantity }, { fromThenOn: true, now });
        await touchAccount(tx, portfolioId, now);
        return inserted.id;
    });
}

/**
 * Saves the holding as the form now has it, possibly in another of the
 * user's accounts. False when the user has no holding with that ID. A
 * linked account's holding, edited, becomes the user's own (source
 * "manual"): it keeps Plaid's ID, so later syncs leave it, and the user's
 * value, alone rather than adding it again. One a positions file brought
 * in stays "csv" with its key, so the next file still updates it. Moved
 * into an account that already has a holding with its key, it goes
 * without the key, which is unique within an account.
 */
export async function updateManualHolding(
    userId: string,
    id: string,
    portfolioId: string,
    input: ManualHoldingInput,
    { database = db, now = new Date() }: { database?: Database; now?: Date } = {},
): Promise<boolean> {
    return database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(userId, tx);
        await ownedAccount(tx, userId, portfolioId);
        const [before] = await tx
            .select({ portfolioId: manualHoldings.portfolioId, source: manualHoldings.source, externalId: manualHoldings.externalId })
            .from(manualHoldings)
            .where(and(eq(manualHoldings.id, id), eq(manualHoldings.userId, userId)))
            .limit(1);
        if (!before) return false;
        let externalId = before.externalId;
        if (externalId !== null && before.portfolioId !== portfolioId) {
            const [taken] = await tx
                .select({ id: manualHoldings.id })
                .from(manualHoldings)
                .where(and(eq(manualHoldings.portfolioId, portfolioId), eq(manualHoldings.userId, userId), eq(manualHoldings.externalId, externalId)))
                .limit(1);
            if (taken) externalId = null;
        }
        await tx
            .update(manualHoldings)
            .set({
                portfolioId,
                ...values(input),
                source: before.source === "csv" ? "csv" : "manual",
                ...(externalId !== before.externalId ? { externalId } : {}),
                updatedAt: now,
            })
            .where(and(eq(manualHoldings.id, id), eq(manualHoldings.userId, userId)));
        const saved = values(input);
        await recordManualValue(tx, id, { date: saved.valueAsOf, value: saved.value, quantity: saved.quantity }, { fromThenOn: true, now });
        await touchAccount(tx, portfolioId, now);
        if (before.portfolioId !== portfolioId) await touchAccount(tx, before.portfolioId, now);
        return true;
    });
}

/** False when the user has no holding with that ID. */
export async function deleteManualHolding(userId: string, id: string, { database = db, now = new Date() }: { database?: Database; now?: Date } = {}): Promise<boolean> {
    return database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(userId, tx);
        const [deleted] = await tx
            .delete(manualHoldings)
            .where(and(eq(manualHoldings.id, id), eq(manualHoldings.userId, userId)))
            .returning({ portfolioId: manualHoldings.portfolioId });
        if (!deleted) return false;
        await touchAccount(tx, deleted.portfolioId, now);
        return true;
    });
}

export type ManualImportResult = ManualPlanSummary;

/**
 * Writes a positions file's rows with no ticker into one of the user's
 * accounts, inside the import's transaction (importHoldings, which holds
 * the user's account lock and the records lock for these holdings, and
 * refuses a linked account that still syncs).
 *
 * The rows are matched to the account's holdings an import may update as
 * planManualImport says: added by hand or by an earlier file, or brought
 * in by the account's own syncs, which a file reaches once the account no
 * longer syncs; never one keyed by another account's syncs (moved from a
 * linked account, which skips it by that key). A new holding is added
 * with source "csv", its import key and the file's day (`asOf`). A match
 * is updated in place and keeps its id, its name and any identifier it
 * had; it takes the row's key and source "csv", so the next file finds
 * it. When the file isn't older than the saved value, the value, units
 * and day are the file's, and the cost too when the file gives one. Every
 * row's value is recorded for the file's day, without dropping later
 * days: an older file only adds to the history.
 *
 * `replace` lists the positions (held under a CUSIP or a plan's number,
 * from before they could be valued by hand) that the caller deletes, since
 * it writes the account's positions. `changed` says whether the account
 * itself changed, as Plaid's rule has it: a holding added or a position
 * replaced, or units or a cost changed. A new value alone is a price.
 */
export async function importManualRows(
    tx: Executor,
    userId: string,
    portfolioId: string,
    rows: readonly ManualImportRow[],
    { asOf, positions, now }: { asOf: string; positions: readonly string[]; now: Date },
): Promise<ManualImportResult & { replace: string[]; changed: boolean }> {
    const saved = await tx
        .select({
            id: manualHoldings.id,
            name: manualHoldings.name,
            identifier: manualHoldings.identifier,
            externalId: manualHoldings.externalId,
            quantity: manualHoldings.quantity,
            value: manualHoldings.value,
            costBasis: manualHoldings.costBasis,
            valueAsOf: manualHoldings.valueAsOf,
        })
        .from(manualHoldings)
        .where(and(
            eq(manualHoldings.portfolioId, portfolioId),
            eq(manualHoldings.userId, userId),
            or(
                isNull(manualHoldings.externalId),
                like(manualHoldings.externalId, `${IMPORT_KEY_PREFIX}%`),
                like(manualHoldings.externalId, `${syncKeyPrefix(portfolioId)}%`),
            ),
        ))
        .orderBy(asc(manualHoldings.name), asc(manualHoldings.id));
    const existing = saved.map((h) => ({
        id: h.id,
        name: h.name,
        identifier: h.identifier,
        // A sync's key is never a file's: such a holding is found by its identifier or name.
        importKey: h.externalId?.startsWith(IMPORT_KEY_PREFIX) ? h.externalId : null,
        quantity: num(h.quantity),
        value: num(h.value) ?? 0,
        costBasis: num(h.costBasis),
        valueAsOf: h.valueAsOf,
    }));
    const byId = new Map(existing.map((h) => [h.id, h]));
    const plan = planManualImport(existing, rows, { asOf, positions });
    const decimal = (n: number | null) => (n === null ? null : String(n));

    const ids = new Map<string, string>();
    const inserts = plan.flatMap((p) => (p.kind === "insert" ? [p] : []));
    if (inserts.length > 0) {
        const created = await tx
            .insert(manualHoldings)
            .values(inserts.map((p) => ({
                userId,
                portfolioId,
                name: p.row.name,
                identifier: p.row.identifier,
                quantity: decimal(p.row.quantity),
                value: String(p.row.value),
                costBasis: decimal(p.row.costBasis),
                valueAsOf: asOf,
                source: "csv",
                externalId: p.key,
                createdAt: now,
                updatedAt: now,
            })))
            .returning({ id: manualHoldings.id, externalId: manualHoldings.externalId });
        for (const c of created) if (c.externalId) ids.set(c.externalId, c.id);
    }
    for (const p of plan) {
        if (p.kind === "insert") continue;
        const holding = byId.get(p.id)!;
        const kept = { externalId: p.key, source: "csv", identifier: holding.identifier ?? p.row.identifier, updatedAt: now };
        await tx
            .update(manualHoldings)
            .set(p.olderThanSaved ? kept : {
                ...kept,
                value: String(p.row.value),
                quantity: decimal(p.row.quantity),
                costBasis: decimal(p.row.costBasis ?? holding.costBasis),
                valueAsOf: asOf,
            })
            .where(and(eq(manualHoldings.id, p.id), eq(manualHoldings.userId, userId)));
    }
    if (plan.length > 0) {
        await tx
            .insert(manualHoldingValues)
            .values(plan.map((p) => ({
                manualHoldingId: p.kind === "insert" ? ids.get(p.key)! : p.id,
                date: asOf,
                value: String(p.row.value),
                quantity: decimal(p.row.quantity),
                recordedAt: now,
            })))
            .onConflictDoUpdate({
                target: [manualHoldingValues.manualHoldingId, manualHoldingValues.date],
                set: { value: sql`excluded.value`, quantity: sql`excluded.quantity`, recordedAt: sql`excluded.recorded_at` },
            });
    }
    const replace = plan.flatMap((p) => (p.replacesPosition !== null ? [p.replacesPosition] : []));
    const changed = plan.some((p) => p.kind === "insert" || p.replacesPosition !== null || p.changesHolding);
    return {
        insert: inserts.length,
        update: plan.filter((p) => p.kind === "update").length,
        unchanged: plan.filter((p) => p.kind === "unchanged").length,
        replacedPositions: replace.length,
        replace,
        changed,
    };
}
