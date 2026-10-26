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

import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";

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
    PlaidDeadlineError,
    type AccountHoldings,
    type TransactionSkipReason,
} from "./investments";
import { PlaidApiError, asRecord, plaidAccountFingerprint, postPlaid, resolvePlaidEnvironment, type PlaidCredentials, type PlaidFetch } from "./link";
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
 * The accounts the user has through their other connections (not revoked),
 * as fingerprints (plaidAccountFingerprint): linking a brokerage again can
 * give the same accounts new IDs, and syncing them twice would count their
 * holdings and cash twice (launch item i46).
 */
export async function connectedAccountFingerprints(
    userId: string,
    { exceptItemId, statuses }: { exceptItemId: string; statuses: readonly string[] },
    database: Executor = db,
): Promise<Set<string>> {
    const rows = await database
        .select({
            institutionId: plaidAccounts.institutionId,
            institutionName: plaidAccounts.institutionName,
            name: plaidAccounts.name,
            mask: plaidAccounts.mask,
            subtype: plaidAccounts.subtype,
        })
        .from(plaidAccounts)
        .innerJoin(plaidItems, eq(plaidItems.id, plaidAccounts.plaidItemRecordId))
        .where(and(
            eq(plaidAccounts.userId, userId),
            ne(plaidItems.plaidItemId, exceptItemId),
            ne(plaidItems.status, "revoked"),
            isNull(plaidItems.revokedAt),
            inArray(plaidAccounts.syncStatus, [...statuses]),
        ));
    return new Set(rows.map((row) => plaidAccountFingerprint(row)));
}

/**
 * The user's pick: these accounts of the item sync, the rest of its
 * accounts don't. Sent after Link, and by "Sync now" with the accounts the
 * user connected in Settings, so an account linked before picks existed
 * can still be picked. Only accounts still waiting for a pick change: one
 * already picked keeps syncing, and one excluded (a linked account the user
 * deleted) stays excluded, and one the user already syncs through another
 * connection (the same account, linked again) isn't picked twice. Only the
 * user's own item; returns how many of its investment accounts were picked
 * now.
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
            .where(and(eq(plaidItems.userId, userId), eq(plaidItems.plaidItemId, itemId), ne(plaidItems.status, "revoked"), isNull(plaidItems.revokedAt)))
            .limit(1);
        if (!item) throw new PlaidItemNotFoundError();
        const ofItem = and(
            eq(plaidAccounts.userId, userId),
            eq(plaidAccounts.plaidItemRecordId, item.id),
            eq(plaidAccounts.syncStatus, "awaiting_selection"),
        );
        // Picked, less any the user already syncs through another connection.
        const syncedElsewhere = await connectedAccountFingerprints(userId, { exceptItemId: itemId, statuses: ["sync_ready"] }, tx);
        const candidates = plaidAccountIds.length === 0 ? [] : await tx
            .select({
                plaidAccountId: plaidAccounts.plaidAccountId,
                institutionId: plaidAccounts.institutionId,
                institutionName: plaidAccounts.institutionName,
                name: plaidAccounts.name,
                mask: plaidAccounts.mask,
                subtype: plaidAccounts.subtype,
            })
            .from(plaidAccounts)
            .where(and(ofItem, inArray(plaidAccounts.plaidAccountId, [...plaidAccountIds])));
        const pickable = candidates.filter((c) => !syncedElsewhere.has(plaidAccountFingerprint(c))).map((c) => c.plaidAccountId);
        const picked = pickable.length > 0 ? inArray(plaidAccounts.plaidAccountId, pickable) : sql`false`;
        const selected = await tx
            .update(plaidAccounts)
            .set({ syncStatus: "sync_ready", updatedAt: new Date() })
            .where(and(ofItem, picked, eq(plaidAccounts.type, "investment")))
            .returning({ id: plaidAccounts.id });
        await tx
            .update(plaidAccounts)
            .set({ syncStatus: "excluded", updatedAt: new Date() })
            .where(and(ofItem, pickable.length > 0 ? notInArray(plaidAccounts.plaidAccountId, pickable) : sql`true`));
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
        .select({ id: plaidItems.id, institutionName: plaidItems.institutionName, status: plaidItems.status })
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
 * Writes one account's sync in a single transaction, under the user's
 * account lock (which deleting an account takes too): its portfolio (made
 * the first time, with a name none of their accounts has and within
 * MAX_ACCOUNTS_PER_USER; the name and description left as the user set them
 * after), its positions and cash replaced, its transactions upserted.
 *
 * Null, writing nothing, when the account no longer syncs (deleted, or its
 * pick undone, while Plaid was being asked) or a sync that started later
 * has written it already (the nightly job and "Sync now" overlapping): an
 * older answer never replaces a newer one. Throws AccountLimitError for a
 * new account past the limit, writing nothing.
 *
 * The portfolio's and its holdings' updated_at move only when a position
 * or the cash changes: the snapshot job (valuation-snapshots.ts) takes them
 * as the last change, so a sync that finds nothing new mustn't look like one.
 */
export async function writeAccountSync(input: AccountSyncWrite, database: Database = db): Promise<AccountSyncWritten | null> {
    return database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(input.userId, tx);
        const [account] = await tx
            .select({ syncStatus: plaidAccounts.syncStatus, holdingsSyncedAt: plaidAccounts.holdingsSyncedAt })
            .from(plaidAccounts)
            .where(and(eq(plaidAccounts.id, input.plaidAccountRecordId), eq(plaidAccounts.userId, input.userId)))
            .limit(1);
        if (account?.syncStatus !== "sync_ready") return null;
        if (account.holdingsSyncedAt && account.holdingsSyncedAt.getTime() > input.now.getTime()) return null;

        const [existing] = await tx
            .select({ id: portfolios.id, name: portfolios.name, cash: portfolios.cashBalance })
            .from(portfolios)
            .where(and(eq(portfolios.userId, input.userId), eq(portfolios.source, "plaid"), eq(portfolios.externalAccountId, input.plaidAccountId)))
            .limit(1);
        let portfolio: { id: string; name: string; created: boolean };
        if (existing) {
            const positionsChanged = await replaceHoldings(tx, existing.id, input.holdings.positions, input.now);
            const cashChanged = existing.cash !== input.holdings.cashUsd;
            if (positionsChanged || cashChanged) {
                await tx
                    .update(portfolios)
                    .set({ cashBalance: input.holdings.cashUsd, updatedAt: input.now })
                    .where(and(eq(portfolios.id, existing.id), eq(portfolios.userId, input.userId)));
            }
            portfolio = { id: existing.id, name: existing.name, created: false };
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
            await replaceHoldings(tx, portfolio.id, input.holdings.positions, input.now);
        }

        const written = input.transactions ? await upsertTransactions(tx, portfolio.id, input.transactions) : { added: 0, updated: 0 };

        await tx
            .update(plaidAccounts)
            .set({
                holdingsSyncedAt: input.now,
                // Only once its history came in: until then the next sync reads two years.
                lastSyncedAt: input.transactions ? input.now : undefined,
                updatedAt: input.now,
            })
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

/**
 * Replaces the portfolio's holdings with `positions`; true when a position
 * was added, removed, or changed in quantity or cost. A holding's
 * updated_at (also the stock split watermark) moves only when its quantity
 * or cost does; a new price or name alone isn't a change in what's held.
 */
async function replaceHoldings(tx: Executor, portfolioId: string, positions: AccountHoldings["positions"], now: Date): Promise<boolean> {
    const held = new Map(
        (await tx
            .select({ symbol: holdings.symbol, quantity: holdings.quantity, avgCost: holdings.avgCost, updatedAt: holdings.updatedAt })
            .from(holdings)
            .where(eq(holdings.portfolioId, portfolioId)))
            .map((h) => [h.symbol, h]),
    );
    const symbols = new Set(positions.map((p) => p.symbol));
    const removed = [...held.keys()].filter((symbol) => !symbols.has(symbol));
    if (removed.length > 0) {
        await tx.delete(holdings).where(and(eq(holdings.portfolioId, portfolioId), inArray(holdings.symbol, removed)));
    }
    let changed = removed.length > 0;
    const rows = positions.map((p) => {
        const before = held.get(p.symbol);
        const same = before !== undefined && Number(before.quantity) === p.quantity && Number(before.avgCost) === p.avgCost;
        if (!same) changed = true;
        return {
            portfolioId,
            symbol: p.symbol,
            name: p.name,
            quantity: String(p.quantity),
            avgCost: String(p.avgCost),
            currentPrice: p.price,
            // Readers value positions at the newest price they have.
            marketValue: null,
            allocation: null,
            updatedAt: same ? before.updatedAt : now,
        };
    });
    if (rows.length > 0) {
        await tx
            .insert(holdings)
            .values(rows)
            .onConflictDoUpdate({
                target: [holdings.portfolioId, holdings.symbol],
                set: {
                    name: sql`excluded.name`,
                    quantity: sql`excluded.quantity`,
                    avgCost: sql`excluded.avg_cost`,
                    currentPrice: sql`excluded.current_price`,
                    marketValue: null,
                    allocation: null,
                    updatedAt: sql`excluded.updated_at`,
                },
            });
    }
    return changed;
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
    | { itemId: string; status: "login-required" | "no-token" | "timed-out" | "failed"; accounts: AccountSyncResult[]; error?: string };

export interface SyncDeps {
    config: PlaidConfig;
    database?: Database;
    fetchImpl?: PlaidFetch;
    getAccessToken?: (itemId: string, userId: string) => Promise<string | undefined>;
    now?: Date;
    /**
     * When to stop asking Plaid (ms since the epoch, by `clock`): a request
     * still waiting then is cancelled and the sync ends "timed-out". Plaid is
     * asked everything before anything is written, so it writes nothing;
     * the next sync tries again.
     */
    deadline?: number;
    clock?: () => number;
}

/** Syncs the item's picked investment accounts; the user's own item only. */
export async function syncPlaidItem(userId: string, itemId: string, deps: SyncDeps): Promise<ItemSyncResult> {
    const { config, database = db, fetchImpl = fetch, getAccessToken = getPlaidAccessTokenForUser, now = new Date(), deadline, clock } = deps;
    const { item, accounts } = await loadSyncTargets(userId, itemId, database);
    if (accounts.length === 0) {
        // Nothing to sync yet (no account picked), but after Link's update
        // mode the login may be fixed: ask Plaid, so the accounts can be picked.
        if (item.status === "login_required") {
            const accessToken = await getAccessToken(itemId, userId);
            if (accessToken) {
                try {
                    const answer = asRecord(asRecord(await postPlaid({ endpoint: "/item/get", ...config, fetchImpl, body: { access_token: accessToken } })).item);
                    if (answer.error == null) {
                        await database
                            .update(plaidItems)
                            .set({ status: "active", updatedAt: now })
                            .where(and(eq(plaidItems.id, item.id), eq(plaidItems.userId, userId), eq(plaidItems.status, "login_required")));
                    }
                } catch {
                    // Plaid unreachable or the login still broken: it stays as it is.
                }
            }
        }
        return { itemId, status: "synced", accounts: [], overLimit: [] };
    }
    // Tried now, however it ends: the nightly job takes the least recently tried first.
    await database
        .update(plaidItems)
        .set({ lastSyncAttemptAt: now })
        .where(and(eq(plaidItems.id, item.id), eq(plaidItems.userId, userId)));

    const accessToken = await getAccessToken(itemId, userId);
    if (!accessToken) return { itemId, status: "no-token", accounts: [] };

    const call = { ...config, accessToken, accountIds: accounts.map((a) => a.plaidAccountId), fetchImpl, deadline, clock };
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
            let written: AccountSyncWritten | null;
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
            // Deleted, or its pick undone, while Plaid was being asked.
            if (!written) continue;
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
            // A sync that went through means the login works again (after
            // Link's update mode, launch item i45).
            .set({ lastSuccessfulSyncAt: now, status: sql`case when ${plaidItems.status} = 'login_required' then 'active' else ${plaidItems.status} end`, updatedAt: now })
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
        if (error instanceof PlaidDeadlineError) return { itemId, status: "timed-out", accounts: [] };
        return { itemId, status: "failed", accounts: [], error: error instanceof Error ? error.message : String(error) };
    }
}

// ---------------------------------------------------------------------------
// The nightly job
// ---------------------------------------------------------------------------

/** Long enough for a few accounts; it leaves the price backfill its time. */
export const PLAID_JOB_BUDGET_MS = 30_000;

/**
 * Syncs every active item with an account to sync, the least recently
 * tried first, until the budget is spent: the rest go first tomorrow, and
 * a connection that keeps running out of time goes to the back rather than
 * taking every night's turn. The budget bounds each request too, so one
 * slow connection can't take the time the price backfill and snapshots
 * after it need.
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
        .selectDistinct({
            userId: plaidItems.userId,
            itemId: plaidItems.plaidItemId,
            lastAttempt: plaidItems.lastSyncAttemptAt,
            lastSync: plaidItems.lastSuccessfulSyncAt,
        })
        .from(plaidItems)
        .innerJoin(plaidAccounts, eq(plaidAccounts.plaidItemRecordId, plaidItems.id))
        .where(and(
            // Not one waiting for its user to sign in again; one whose consent
            // ends soon still works until then.
            inArray(plaidItems.status, ["active", "pending_expiration"]),
            isNull(plaidItems.revokedAt),
            eq(plaidAccounts.syncStatus, "sync_ready"),
            eq(plaidAccounts.type, "investment"),
        ))
        .orderBy(sql`${plaidItems.lastSyncAttemptAt} asc nulls first`, sql`${plaidItems.lastSuccessfulSyncAt} asc nulls first`);

    const counts = { synced: 0, loginRequired: 0, noToken: 0, timedOut: 0, failed: 0, accounts: 0, positions: 0, transactionsAdded: 0 };
    let done = 0;
    for (const { userId, itemId } of items) {
        if (clock() >= deadline) break;
        const result = await syncPlaidItem(userId, itemId, { config, database, fetchImpl, getAccessToken, now: new Date(clock()), deadline, clock })
            .catch((error: unknown): ItemSyncResult => ({ itemId, status: "failed", accounts: [], error: String(error) }));
        done++;
        if (result.status === "synced") counts.synced++;
        else if (result.status === "login-required") counts.loginRequired++;
        else if (result.status === "no-token") counts.noToken++;
        else if (result.status === "timed-out") counts.timedOut++;
        else counts.failed++;
        counts.accounts += result.accounts.length;
        for (const account of result.accounts) {
            counts.positions += account.positions;
            counts.transactionsAdded += account.transactionsAdded;
        }
    }
    return { items: items.length, ...counts, remaining: items.length - done };
}
