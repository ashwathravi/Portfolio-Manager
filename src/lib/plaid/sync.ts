/**
 * Plaid sync (launch item i44, decision D5): each linked investment account
 * the user picked is one portfolio. A sync replaces its holdings and cash
 * with what the institution reports, and upserts its transactions by
 * Plaid's ID, so syncing again changes nothing that hasn't changed.
 *
 * Accounts start as "awaiting_selection" when Link finds them; the user's
 * pick (selectPlaidAccounts) marks them "sync_ready" or "excluded", and
 * only "sync_ready" investment accounts are synced, here on request and by
 * the nightly job (syncAllPlaidItems).
 */

import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdings, plaidAccounts, plaidItems, portfolios, transactions } from "@/db/schema";
import {
    AccountLimitError,
    MAX_ACCOUNTS_PER_USER,
    buildLockUserAccountsQuery,
    buildUserAccountNamesQuery,
    sameAccountName,
} from "@/lib/portfolio/manage";
import { transactionValues } from "@/lib/portfolio/transactionsWrite";
import { PORTFOLIO_LIMITS } from "@/lib/validators/portfolio";
import type { TransactionRow } from "@/lib/validators/transaction";

import {
    PLAID_HISTORY_DAYS,
    accountHoldings,
    accountTransactions,
    fetchPlaidHoldings,
    fetchPlaidInvestmentTransactions,
    type AccountHoldings,
    type TransactionSkipReason,
} from "./investments";
import { PlaidApiError, resolvePlaidEnvironment, type PlaidCredentials, type PlaidFetch } from "./link";
import { getPlaidAccessTokenForUser } from "./server-token-vault";
import type { PlaidEnvironment } from "./types";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface PlaidConfig {
    credentials: PlaidCredentials;
    environment: PlaidEnvironment;
}

/** Plaid's keys from the environment; null when they aren't set. */
export function plaidConfigFromEnv(env: Record<string, string | undefined> = process.env): PlaidConfig | null {
    const clientId = env.PLAID_CLIENT_ID?.trim();
    const secret = env.PLAID_SECRET?.trim();
    if (!clientId || !secret) return null;
    return { credentials: { clientId, secret }, environment: resolvePlaidEnvironment(env.PLAID_ENV) };
}

export class PlaidItemNotFoundError extends Error {
    constructor() {
        super("Plaid connection not found");
        this.name = "PlaidItemNotFoundError";
    }
}

const DAY_MS = 86_400_000;
/** Each sync looks back this far past the last, for late postings. */
const OVERLAP_DAYS = 30;
const WRITE_CHUNK = 1000;

function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** The first day a sync asks Plaid for: two years back the first time. */
export function transactionsStart(lastSyncedAt: Date | null, now: Date): string {
    const earliest = now.getTime() - PLAID_HISTORY_DAYS * DAY_MS;
    if (!lastSyncedAt) return isoDate(new Date(earliest));
    return isoDate(new Date(Math.max(earliest, lastSyncedAt.getTime() - OVERLAP_DAYS * DAY_MS)));
}

/** "Fidelity Individual", within the length an account name may be. */
export function linkedPortfolioName(institutionName: string | null, accountName: string): string {
    const institution = institutionName?.trim();
    const account = accountName.trim() || "Account";
    const name = institution && !account.toLowerCase().startsWith(institution.toLowerCase()) ? `${institution} ${account}` : account;
    return name.slice(0, PORTFOLIO_LIMITS.name);
}

/**
 * A name none of the user's accounts has (names are unique per user): the
 * account's own, then with its last four digits, then numbered.
 */
export function uniqueAccountName(name: string, mask: string | null, taken: readonly string[]): string {
    const free = (candidate: string) => !taken.some((t) => sameAccountName(t, candidate));
    const fit = (suffix: string) => `${name.slice(0, PORTFOLIO_LIMITS.name - suffix.length).trimEnd()}${suffix}`;
    if (free(name)) return name;
    if (mask && free(fit(` ••${mask}`))) return fit(` ••${mask}`);
    for (let n = 2; ; n++) if (free(fit(` (${n})`))) return fit(` (${n})`);
}

/** "Fidelity ••1234 · linked through Plaid". */
export function linkedPortfolioDescription(institutionName: string | null, mask: string | null): string {
    const where = [institutionName?.trim(), mask ? `••${mask}` : null].filter(Boolean).join(" ");
    return [where, "linked through Plaid"].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Which accounts sync
// ---------------------------------------------------------------------------

/**
 * The user's pick from Link: these accounts of the item sync, the rest of
 * its accounts don't. Only the user's own, active item; returns how many
 * investment accounts will sync.
 */
export async function selectPlaidAccounts(
    userId: string,
    itemId: string,
    plaidAccountIds: readonly string[],
    database: Database = db,
): Promise<number> {
    return database.transaction(async (tx) => {
        const [item] = await tx
            .select({ id: plaidItems.id })
            .from(plaidItems)
            .where(and(eq(plaidItems.userId, userId), eq(plaidItems.plaidItemId, itemId), eq(plaidItems.status, "active"), isNull(plaidItems.revokedAt)))
            .limit(1);
        if (!item) throw new PlaidItemNotFoundError();
        const ofItem = and(eq(plaidAccounts.userId, userId), eq(plaidAccounts.plaidItemRecordId, item.id));
        const picked = plaidAccountIds.length > 0 ? inArray(plaidAccounts.plaidAccountId, [...plaidAccountIds]) : sql`false`;
        const selected = await tx
            .update(plaidAccounts)
            .set({ syncStatus: "sync_ready", updatedAt: new Date() })
            .where(and(ofItem, picked, eq(plaidAccounts.type, "investment")))
            .returning({ id: plaidAccounts.id });
        await tx
            .update(plaidAccounts)
            .set({ syncStatus: "excluded", updatedAt: new Date() })
            .where(and(ofItem, plaidAccountIds.length > 0 ? notInArray(plaidAccounts.plaidAccountId, [...plaidAccountIds]) : sql`true`));
        return selected.length;
    });
}

interface SyncTarget {
    recordId: string;
    plaidAccountId: string;
    name: string;
    mask: string | null;
    lastSyncedAt: Date | null;
}

async function loadSyncTargets(userId: string, itemId: string, database: Database) {
    const [item] = await database
        .select({ id: plaidItems.id, institutionName: plaidItems.institutionName })
        .from(plaidItems)
        .where(and(eq(plaidItems.userId, userId), eq(plaidItems.plaidItemId, itemId), isNull(plaidItems.revokedAt)))
        .limit(1);
    if (!item) throw new PlaidItemNotFoundError();
    const accounts: SyncTarget[] = await database
        .select({
            recordId: plaidAccounts.id,
            plaidAccountId: plaidAccounts.plaidAccountId,
            name: plaidAccounts.name,
            mask: plaidAccounts.mask,
            lastSyncedAt: plaidAccounts.lastSyncedAt,
        })
        .from(plaidAccounts)
        .where(and(
            eq(plaidAccounts.userId, userId),
            eq(plaidAccounts.plaidItemRecordId, item.id),
            eq(plaidAccounts.syncStatus, "sync_ready"),
            eq(plaidAccounts.type, "investment"),
        ))
        .orderBy(asc(plaidAccounts.name));
    return { item, accounts };
}

// ---------------------------------------------------------------------------
// Writing one account
// ---------------------------------------------------------------------------

export interface AccountSyncWrite {
    userId: string;
    plaidAccountRecordId: string;
    plaidAccountId: string;
    name: string;
    /** The account number's last four digits, to tell two same-named accounts apart. */
    mask: string | null;
    description: string;
    holdings: Pick<AccountHoldings, "positions" | "cashUsd">;
    /** Null when Plaid's history isn't ready yet: transactions wait for the next sync. */
    transactions: readonly (TransactionRow & { externalId: string })[] | null;
    now: Date;
}

export interface AccountSyncWritten {
    portfolioId: string;
    /** The portfolio's name as stored: the user's, once they've renamed it. */
    name: string;
    created: boolean;
    positions: number;
    transactionsAdded: number;
    transactionsUpdated: number;
}

/**
 * Writes one account's sync in a single transaction: its portfolio (made
 * the first time, under the user's account lock, with a name none of their
 * accounts has and within MAX_ACCOUNTS_PER_USER; the name and description
 * left as the user set them after), its positions and cash replaced, its
 * transactions upserted. Throws AccountLimitError for a new account past
 * the limit, writing nothing.
 */
export async function writeAccountSync(input: AccountSyncWrite, database: Database = db): Promise<AccountSyncWritten> {
    return database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(input.userId, tx);
        const [existing] = await tx
            .update(portfolios)
            .set({ cashBalance: input.holdings.cashUsd, updatedAt: input.now })
            .where(and(eq(portfolios.userId, input.userId), eq(portfolios.source, "plaid"), eq(portfolios.externalAccountId, input.plaidAccountId)))
            .returning({ id: portfolios.id, name: portfolios.name });
        let portfolio: { id: string; name: string; created: boolean };
        if (existing) {
            portfolio = { ...existing, created: false };
        } else {
            const accounts = await buildUserAccountNamesQuery(input.userId, tx);
            if (accounts.length >= MAX_ACCOUNTS_PER_USER) throw new AccountLimitError();
            const [created] = await tx
                .insert(portfolios)
                .values({
                    userId: input.userId,
                    name: uniqueAccountName(input.name, input.mask, accounts.map((a) => a.name)),
                    description: input.description,
                    cashBalance: input.holdings.cashUsd,
                    source: "plaid",
                    externalAccountId: input.plaidAccountId,
                    updatedAt: input.now,
                })
                .returning({ id: portfolios.id, name: portfolios.name });
            portfolio = { ...created, created: true };
        }

        await replaceHoldings(tx, portfolio.id, input.holdings.positions, input.now);
        const written = input.transactions ? await upsertTransactions(tx, portfolio.id, input.transactions) : { added: 0, updated: 0 };

        await tx
            .update(plaidAccounts)
            .set({ syncStatus: "sync_ready", lastSyncedAt: input.transactions ? input.now : undefined, updatedAt: input.now })
            .where(and(eq(plaidAccounts.id, input.plaidAccountRecordId), eq(plaidAccounts.userId, input.userId)));

        return {
            portfolioId: portfolio.id,
            name: portfolio.name,
            created: portfolio.created,
            positions: input.holdings.positions.length,
            transactionsAdded: written.added,
            transactionsUpdated: written.updated,
        };
    });
}

async function replaceHoldings(tx: Executor, portfolioId: string, positions: AccountHoldings["positions"], now: Date) {
    const symbols = positions.map((p) => p.symbol);
    await tx
        .delete(holdings)
        .where(and(eq(holdings.portfolioId, portfolioId), symbols.length > 0 ? notInArray(holdings.symbol, symbols) : sql`true`));
    if (positions.length === 0) return;
    await tx
        .insert(holdings)
        .values(positions.map((p) => ({
            portfolioId,
            symbol: p.symbol,
            name: p.name,
            quantity: String(p.quantity),
            avgCost: String(p.avgCost),
            currentPrice: p.price,
            // Readers value positions at the newest price they have.
            marketValue: null,
            allocation: null,
            updatedAt: now,
        })))
        .onConflictDoUpdate({
            target: [holdings.portfolioId, holdings.symbol],
            set: {
                name: sql`excluded.name`,
                quantity: sql`excluded.quantity`,
                avgCost: sql`excluded.avg_cost`,
                currentPrice: sql`excluded.current_price`,
                marketValue: null,
                allocation: null,
                updatedAt: now,
            },
        });
}

async function upsertTransactions(tx: Executor, portfolioId: string, rows: readonly (TransactionRow & { externalId: string })[]) {
    let added = 0;
    let updated = 0;
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
        const values = rows.slice(i, i + WRITE_CHUNK).map((row) => transactionValues(portfolioId, row, "plaid", row.externalId));
        const written = await tx
            .insert(transactions)
            .values(values)
            .onConflictDoUpdate({
                target: [transactions.portfolioId, transactions.externalId],
                targetWhere: sql`${transactions.externalId} is not null`,
                set: {
                    type: sql`excluded.type`,
                    symbol: sql`excluded.symbol`,
                    quantity: sql`excluded.quantity`,
                    price: sql`excluded.price`,
                    amount: sql`excluded.amount`,
                    fees: sql`excluded.fees`,
                    currency: sql`excluded.currency`,
                    timestamp: sql`excluded.timestamp`,
                    notes: sql`excluded.notes`,
                },
            })
            .returning({ inserted: sql<boolean>`(xmax = 0)` });
        for (const row of written) {
            if (row.inserted) added++;
            else updated++;
        }
    }
    return { added, updated };
}

// ---------------------------------------------------------------------------
// Syncing an item
// ---------------------------------------------------------------------------

export interface AccountSyncResult extends AccountSyncWritten {
    plaidAccountId: string;
    cashUsd: number;
    /** Holdings not brought in (no ticker, an option, another currency, a short). */
    holdingsSkipped: number;
    /** Positions whose cost Plaid didn't report, held at their price. */
    costUnknown: number;
    transactionsSkipped: Partial<Record<TransactionSkipReason, number>>;
    /** Plaid's history wasn't ready; the next sync brings it. */
    transactionsPending: boolean;
}

export type ItemSyncResult =
    /** `overLimit`: picked accounts not added, the user having the most accounts Atlas keeps. */
    | { itemId: string; status: "synced"; accounts: AccountSyncResult[]; overLimit: string[] }
    | { itemId: string; status: "login-required" | "no-token" | "failed"; accounts: AccountSyncResult[]; error?: string };

export interface SyncDeps {
    config: PlaidConfig;
    database?: Database;
    fetchImpl?: PlaidFetch;
    getAccessToken?: (itemId: string, userId: string) => Promise<string | undefined>;
    now?: Date;
}

/** Syncs the item's picked investment accounts; the user's own item only. */
export async function syncPlaidItem(userId: string, itemId: string, deps: SyncDeps): Promise<ItemSyncResult> {
    const { config, database = db, fetchImpl = fetch, getAccessToken = getPlaidAccessTokenForUser, now = new Date() } = deps;
    const { item, accounts } = await loadSyncTargets(userId, itemId, database);
    if (accounts.length === 0) return { itemId, status: "synced", accounts: [], overLimit: [] };

    const accessToken = await getAccessToken(itemId, userId);
    if (!accessToken) return { itemId, status: "no-token", accounts: [] };

    const call = { ...config, accessToken, accountIds: accounts.map((a) => a.plaidAccountId), fetchImpl };
    try {
        const holdingsPayload = await fetchPlaidHoldings(call);
        let history: Awaited<ReturnType<typeof fetchPlaidInvestmentTransactions>> | null = null;
        try {
            const earliest = accounts.reduce<Date | null>(
                (min, a) => (a.lastSyncedAt === null || min === null ? null : a.lastSyncedAt < min ? a.lastSyncedAt : min),
                accounts[0].lastSyncedAt,
            );
            history = await fetchPlaidInvestmentTransactions({ ...call, startDate: transactionsStart(earliest, now), endDate: isoDate(now) });
        } catch (error) {
            // Shortly after Link the history may not be ready: positions now,
            // transactions with the next sync.
            if (!(error instanceof PlaidApiError && error.errorCode === "PRODUCT_NOT_READY")) throw error;
        }

        const results: AccountSyncResult[] = [];
        const overLimit: string[] = [];
        for (const account of accounts) {
            const held = accountHoldings(account.plaidAccountId, holdingsPayload.holdings, holdingsPayload.securities);
            const activity = history ? accountTransactions(account.plaidAccountId, history.transactions, history.securities) : null;
            let written: AccountSyncWritten;
            try {
                written = await writeAccountSync({
                    userId,
                    plaidAccountRecordId: account.recordId,
                    plaidAccountId: account.plaidAccountId,
                    name: linkedPortfolioName(item.institutionName, account.name),
                    mask: account.mask,
                    description: linkedPortfolioDescription(item.institutionName, account.mask),
                    holdings: held,
                    transactions: activity?.rows ?? null,
                    now,
                }, database);
            } catch (error) {
                if (!(error instanceof AccountLimitError)) throw error;
                overLimit.push(linkedPortfolioName(item.institutionName, account.name));
                continue;
            }
            results.push({
                ...written,
                plaidAccountId: account.plaidAccountId,
                cashUsd: held.cashUsd,
                holdingsSkipped: held.skipped.length,
                costUnknown: held.costUnknown.length,
                transactionsSkipped: activity?.skipped ?? {},
                transactionsPending: activity === null,
            });
        }
        await database
            .update(plaidItems)
            .set({ lastSuccessfulSyncAt: now, updatedAt: now })
            .where(and(eq(plaidItems.id, item.id), eq(plaidItems.userId, userId)));
        return { itemId, status: "synced", accounts: results, overLimit };
    } catch (error) {
        if (error instanceof PlaidApiError && error.errorCode === "ITEM_LOGIN_REQUIRED") {
            // The institution wants the user to sign in again (Link's update
            // mode, launch item i45); until then nothing more is asked of it.
            await database
                .update(plaidItems)
                .set({ status: "login_required", updatedAt: now })
                .where(and(eq(plaidItems.id, item.id), eq(plaidItems.userId, userId)));
            return { itemId, status: "login-required", accounts: [] };
        }
        return { itemId, status: "failed", accounts: [], error: error instanceof Error ? error.message : String(error) };
    }
}

// ---------------------------------------------------------------------------
// The nightly job
// ---------------------------------------------------------------------------

/** Long enough for a few accounts; it leaves the price backfill its time. */
export const PLAID_JOB_BUDGET_MS = 30_000;

/**
 * Syncs every active item with an account to sync, the longest unsynced
 * first, until the budget is spent; the rest go first tomorrow.
 */
export async function syncAllPlaidItems({
    config = plaidConfigFromEnv(),
    budgetMs = PLAID_JOB_BUDGET_MS,
    database = db,
    fetchImpl,
    getAccessToken,
    clock = () => Date.now(),
}: {
    config?: PlaidConfig | null;
    budgetMs?: number;
    database?: Database;
    fetchImpl?: PlaidFetch;
    getAccessToken?: SyncDeps["getAccessToken"];
    clock?: () => number;
} = {}): Promise<Record<string, unknown>> {
    if (!config) return { skipped: "PLAID_NOT_CONFIGURED" };
    const deadline = clock() + budgetMs;
    const items = await database
        .selectDistinct({ userId: plaidItems.userId, itemId: plaidItems.plaidItemId, lastSync: plaidItems.lastSuccessfulSyncAt })
        .from(plaidItems)
        .innerJoin(plaidAccounts, eq(plaidAccounts.plaidItemRecordId, plaidItems.id))
        .where(and(
            eq(plaidItems.status, "active"),
            isNull(plaidItems.revokedAt),
            eq(plaidAccounts.syncStatus, "sync_ready"),
            eq(plaidAccounts.type, "investment"),
        ))
        .orderBy(sql`${plaidItems.lastSuccessfulSyncAt} asc nulls first`);

    const counts = { synced: 0, loginRequired: 0, noToken: 0, failed: 0, accounts: 0, positions: 0, transactionsAdded: 0 };
    let done = 0;
    for (const { userId, itemId } of items) {
        if (clock() >= deadline) break;
        const result = await syncPlaidItem(userId, itemId, { config, database, fetchImpl, getAccessToken, now: new Date(clock()) })
            .catch((error: unknown): ItemSyncResult => ({ itemId, status: "failed", accounts: [], error: String(error) }));
        done++;
        if (result.status === "synced") counts.synced++;
        else if (result.status === "login-required") counts.loginRequired++;
        else if (result.status === "no-token") counts.noToken++;
        else counts.failed++;
        counts.accounts += result.accounts.length;
        for (const account of result.accounts) {
            counts.positions += account.positions;
            counts.transactionsAdded += account.transactionsAdded;
        }
    }
    return { items: items.length, ...counts, remaining: items.length - done };
}
