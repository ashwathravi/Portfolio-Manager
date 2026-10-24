/**
 * Creating, changing and deleting the user's accounts (launch item i41).
 * Every query is scoped to the user's ID, which the API routes take from
 * the session: another user's account reads as not found.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { portfolios } from "@/db/schema";
import type { PortfolioCreateBody, PortfolioUpdateBody } from "@/lib/validators/portfolio";

type Database = typeof db;

export interface ManagedPortfolio {
    id: string;
    name: string;
    description: string | null;
    cashBalance: number;
}

const returned = {
    id: portfolios.id,
    name: portfolios.name,
    description: portfolios.description,
    cashBalance: portfolios.cashBalance,
};

function toManaged(row: { id: string; name: string; description: string | null; cashBalance: number | null }): ManagedPortfolio {
    return { ...row, cashBalance: row.cashBalance ?? 0 };
}

export function buildCreatePortfolioQuery(userId: string, body: PortfolioCreateBody, database: Database = db) {
    return database
        .insert(portfolios)
        .values({
            userId,
            name: body.name,
            description: body.description || null,
            cashBalance: body.cashBalance ?? 0,
            totalValue: body.cashBalance ?? 0,
        })
        .returning(returned);
}

export async function createPortfolio(userId: string, body: PortfolioCreateBody, database: Database = db): Promise<ManagedPortfolio> {
    const [row] = await buildCreatePortfolioQuery(userId, body, database);
    return toManaged(row);
}

export function buildUpdatePortfolioQuery(userId: string, id: string, body: PortfolioUpdateBody, now: Date, database: Database = db) {
    return database
        .update(portfolios)
        .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description || null } : {}),
            ...(body.cashBalance !== undefined ? { cashBalance: body.cashBalance } : {}),
            updatedAt: now,
        })
        .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
        .returning(returned);
}

/** The changed account, or null when the user has no account with that ID. */
export async function updatePortfolio(
    userId: string,
    id: string,
    body: PortfolioUpdateBody,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<ManagedPortfolio | null> {
    const [row] = await buildUpdatePortfolioQuery(userId, id, body, now, database);
    return row ? toManaged(row) : null;
}

export function buildDeletePortfolioQuery(userId: string, id: string, database: Database = db) {
    return database
        .delete(portfolios)
        .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
        .returning({ id: portfolios.id });
}

/**
 * Deletes the account with its holdings, transactions and valuation
 * history (all cascade). False when the user has no account with that ID.
 */
export async function deletePortfolio(userId: string, id: string, database: Database = db): Promise<boolean> {
    const rows = await buildDeletePortfolioQuery(userId, id, database);
    return rows.length > 0;
}
