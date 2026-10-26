/**
 * Creating, changing and deleting the user's accounts (launch item i41).
 * Every query is scoped to the user's ID, which the API routes take from
 * the session: another user's account reads as not found.
 *
 * Names are unique per user, ignoring case and surrounding spaces, so the
 * pages that list accounts by name (the import's account picker, the
 * Returns switcher) can tell them apart; a user has at most
 * MAX_ACCOUNTS_PER_USER, since the nightly snapshot job values every one.
 * Both are checked under a per-user advisory lock held to the end of the
 * write's transaction, so two requests can't race past them. Creating,
 * renaming and the CSV import's new account all go through
 * `checkAccountName`.
 */

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { plaidAccounts, portfolios } from "@/db/schema";
import type { PortfolioCreateBody, PortfolioUpdateBody } from "@/lib/validators/portfolio";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const MAX_ACCOUNTS_PER_USER = 50;

export class DuplicateAccountNameError extends Error {
    constructor(readonly accountName: string) {
        super(`An account named ${accountName} already exists`);
        this.name = "DuplicateAccountNameError";
    }
}

export class AccountLimitError extends Error {
    constructor() {
        super(`At most ${MAX_ACCOUNTS_PER_USER} accounts`);
        this.name = "AccountLimitError";
    }
}

/** Account names compare without case or surrounding spaces. */
export function sameAccountName(a: string, b: string): boolean {
    return a.trim().toLocaleLowerCase("en-US") === b.trim().toLocaleLowerCase("en-US");
}

/** Waits for, then holds to the end of the transaction, the lock on one user's account writes. */
export function buildLockUserAccountsQuery(userId: string, database: Pick<Database, "execute"> = db) {
    return database.execute(sql`select pg_advisory_xact_lock(hashtext(${`atlas:accounts:${userId}`}))`);
}

export function buildUserAccountNamesQuery(userId: string, database: Pick<Database, "select"> = db) {
    return database
        .select({ id: portfolios.id, name: portfolios.name })
        .from(portfolios)
        .where(eq(portfolios.userId, userId))
        .orderBy(asc(portfolios.name), asc(portfolios.id));
}

export type AccountNameCheck = "ok" | "not-found" | "duplicate" | "limit";

/**
 * Whether the user may give `name` to an account: a new one (`accountId`
 * null), refused past the limit, or one of theirs ("not-found" otherwise).
 * Keeping an account's own name, in any case, is always fine, so an
 * account that already shares a name can still be edited; any other
 * account's name is a duplicate.
 */
export function accountNameCheck(
    accounts: ReadonlyArray<{ id: string; name: string }>,
    name: string,
    accountId: string | null,
): AccountNameCheck {
    if (accountId === null) {
        if (accounts.length >= MAX_ACCOUNTS_PER_USER) return "limit";
    } else {
        const current = accounts.find((a) => a.id === accountId);
        if (!current) return "not-found";
        if (sameAccountName(current.name, name)) return "ok";
    }
    return accounts.some((a) => a.id !== accountId && sameAccountName(a.name, name)) ? "duplicate" : "ok";
}

/**
 * Inside `tx`: takes the user's lock, then applies `accountNameCheck`,
 * throwing for a duplicate name or the limit. False when `accountId` isn't
 * one of the user's.
 */
export async function checkAccountName(tx: Transaction, userId: string, name: string, accountId: string | null): Promise<boolean> {
    await buildLockUserAccountsQuery(userId, tx);
    const check = accountNameCheck(await buildUserAccountNamesQuery(userId, tx), name, accountId);
    if (check === "limit") throw new AccountLimitError();
    if (check === "duplicate") throw new DuplicateAccountNameError(name);
    return check === "ok";
}

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

export function buildCreatePortfolioQuery(userId: string, body: PortfolioCreateBody, database: Pick<Database, "insert"> = db) {
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
    return database.transaction(async (tx) => {
        await checkAccountName(tx, userId, body.name, null);
        const [row] = await buildCreatePortfolioQuery(userId, body, tx);
        return toManaged(row);
    });
}

/**
 * `updated_at` marks the account's last financial change: valuation
 * snapshots (valuation-snapshots.ts) skip every close before it. So only a
 * change of cash moves it; a new name or description, or the same cash
 * again, leaves it where it was.
 */
export function buildUpdatePortfolioQuery(userId: string, id: string, body: PortfolioUpdateBody, now: Date, database: Pick<Database, "update"> = db) {
    return database
        .update(portfolios)
        .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description || null } : {}),
            ...(body.cashBalance !== undefined
                ? {
                    cashBalance: body.cashBalance,
                    updatedAt: sql`case when ${portfolios.cashBalance} is distinct from ${body.cashBalance} then ${now.toISOString()}::timestamp else ${portfolios.updatedAt} end`,
                }
                : {}),
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
    if (body.name === undefined) {
        const [row] = await buildUpdatePortfolioQuery(userId, id, body, now, database);
        return row ? toManaged(row) : null;
    }
    return database.transaction(async (tx) => {
        if (!(await checkAccountName(tx, userId, body.name!, id))) return null;
        const [row] = await buildUpdatePortfolioQuery(userId, id, body, now, tx);
        return row ? toManaged(row) : null;
    });
}

export function buildDeletePortfolioQuery(userId: string, id: string, database: Executor = db) {
    return database
        .delete(portfolios)
        .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
        .returning({ id: portfolios.id, source: portfolios.source, externalAccountId: portfolios.externalAccountId });
}

/** A deleted linked account stays deleted: its Plaid account no longer syncs. */
export function buildExcludeLinkedAccountQuery(userId: string, plaidAccountId: string, now: Date, database: Executor = db) {
    return database
        .update(plaidAccounts)
        .set({ syncStatus: "excluded", updatedAt: now })
        .where(and(eq(plaidAccounts.userId, userId), eq(plaidAccounts.plaidAccountId, plaidAccountId)));
}

/**
 * Deletes the account with its holdings, transactions and valuation
 * history (all cascade). False when the user has no account with that ID.
 * A linked account's Plaid account stops syncing, or the next sync would
 * bring it back; under the user's account lock, which a sync's write takes
 * too, so a sync already asking Plaid finds it gone rather than writing it
 * back.
 */
export async function deletePortfolio(userId: string, id: string, database: Database = db, now: Date = new Date()): Promise<boolean> {
    return database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(userId, tx);
        const [deleted] = await buildDeletePortfolioQuery(userId, id, tx);
        if (!deleted) return false;
        if (deleted.source === "plaid" && deleted.externalAccountId) {
            await buildExcludeLinkedAccountQuery(userId, deleted.externalAccountId, now, tx);
        }
        return true;
    });
}
