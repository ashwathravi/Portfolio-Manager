/**
 * Holdings valued by hand (manual_holdings in schema.ts): reading them for
 * an account's value, and the user's own adds, edits and deletes. Every
 * query is scoped to the user's ID: another user's holding or account
 * reads as not found.
 */

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { manualHoldings, portfolios } from "@/db/schema";
import type { ManualHoldingInput } from "@/lib/validators/manual-holding";
import { buildLockUserAccountsQuery } from "./manage";
import { AccountNotFoundError } from "./transactionsWrite";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

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
}

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
        })
        .from(manualHoldings)
        .where(eq(manualHoldings.userId, userId))
        .orderBy(asc(manualHoldings.name), asc(manualHoldings.id));
}

/** The user's holdings valued by hand, across their accounts. */
export async function loadManualHoldings(userId: string, database: Database = db): Promise<ManualHolding[]> {
    const rows = await buildUserManualHoldingsQuery(userId, database);
    return rows.map((r) => ({
        ...r,
        quantity: num(r.quantity),
        value: num(r.value) ?? 0,
        costBasis: num(r.costBasis),
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
 * The account's last change moves with it: the nightly valuation takes the
 * newest of an account's changes as the day its history may be rewritten from.
 */
async function touchAccount(tx: Executor, portfolioId: string, now: Date) {
    await tx.update(portfolios).set({ updatedAt: now }).where(eq(portfolios.id, portfolioId));
}

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
        const [inserted] = await tx
            .insert(manualHoldings)
            .values({ userId, portfolioId, ...values(input), source: "manual", createdAt: now, updatedAt: now })
            .returning({ id: manualHoldings.id });
        await touchAccount(tx, portfolioId, now);
        return inserted.id;
    });
}

/**
 * Saves the holding as the form now has it, possibly in another of the
 * user's accounts. False when the user has no holding with that ID. A
 * linked account's holding, edited, becomes the user's own (source
 * "manual"): it keeps Plaid's ID, so later syncs leave it, and the user's
 * value, alone rather than adding it again.
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
            .select({ portfolioId: manualHoldings.portfolioId })
            .from(manualHoldings)
            .where(and(eq(manualHoldings.id, id), eq(manualHoldings.userId, userId)))
            .limit(1);
        if (!before) return false;
        await tx
            .update(manualHoldings)
            .set({ portfolioId, ...values(input), source: "manual", updatedAt: now })
            .where(and(eq(manualHoldings.id, id), eq(manualHoldings.userId, userId)));
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
