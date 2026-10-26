/**
 * Linked Plaid connections (launch items i45 and i46): what Settings lists
 * (from the database, not this browser's settings), disconnecting one, and
 * what Plaid's webhooks change.
 *
 * A connection's status: "active"; "login_required" when the institution
 * wants its user to sign in again (Link's update mode repairs it, and the
 * nightly job leaves it until then); "pending_expiration" when its consent
 * ends soon (it still syncs; reconnecting renews it); "revoked" once
 * disconnected, here or at the institution, with its token wiped and its
 * accounts no longer synced. Linked accounts already brought in stay, as
 * the user's accounts, until the user deletes them.
 */

import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { plaidAccounts, plaidItems, portfolios } from "@/db/schema";

import { PlaidApiError, postPlaid, type PlaidFetch } from "./link";
import { forgetPlaidAccessToken, getPlaidAccessTokenForUser } from "./server-token-vault";
import { PlaidItemNotFoundError, type PlaidConfig } from "./sync";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type PlaidConnectionStatus = "active" | "login_required" | "pending_expiration";

export interface PlaidConnectionAccount {
    plaidAccountId: string;
    name: string;
    mask: string | null;
    type: string;
    subtype: string;
    /** "awaiting_selection" (not picked yet), "sync_ready" or "excluded". */
    syncStatus: string;
    lastSyncedAt: string | null;
    /** The account it syncs into, once it has. */
    portfolio: { id: string; name: string } | null;
}

export interface PlaidConnection {
    itemId: string;
    institutionName: string | null;
    status: PlaidConnectionStatus;
    lastSuccessfulSyncAt: string | null;
    accounts: PlaidConnectionAccount[];
}

function statusOf(raw: string): PlaidConnectionStatus {
    return raw === "login_required" || raw === "pending_expiration" ? raw : "active";
}

/** The user's connections that aren't revoked, oldest first, each with its accounts. */
export async function listPlaidConnections(userId: string, database: Database = db): Promise<PlaidConnection[]> {
    const items = await database
        .select({
            id: plaidItems.id,
            itemId: plaidItems.plaidItemId,
            institutionName: plaidItems.institutionName,
            status: plaidItems.status,
            lastSuccessfulSyncAt: plaidItems.lastSuccessfulSyncAt,
        })
        .from(plaidItems)
        .where(and(eq(plaidItems.userId, userId), ne(plaidItems.status, "revoked"), isNull(plaidItems.revokedAt)))
        .orderBy(asc(plaidItems.createdAt), asc(plaidItems.id));
    if (items.length === 0) return [];

    const accounts = await database
        .select({
            itemRecordId: plaidAccounts.plaidItemRecordId,
            plaidAccountId: plaidAccounts.plaidAccountId,
            name: plaidAccounts.name,
            mask: plaidAccounts.mask,
            type: plaidAccounts.type,
            subtype: plaidAccounts.subtype,
            syncStatus: plaidAccounts.syncStatus,
            lastSyncedAt: plaidAccounts.holdingsSyncedAt,
            portfolioId: portfolios.id,
            portfolioName: portfolios.name,
        })
        .from(plaidAccounts)
        .leftJoin(portfolios, and(
            eq(portfolios.userId, userId),
            eq(portfolios.source, "plaid"),
            eq(portfolios.externalAccountId, plaidAccounts.plaidAccountId),
        ))
        .where(and(eq(plaidAccounts.userId, userId), inArray(plaidAccounts.plaidItemRecordId, items.map((i) => i.id))))
        .orderBy(asc(plaidAccounts.name), asc(plaidAccounts.plaidAccountId));

    return items.map((item) => ({
        itemId: item.itemId,
        institutionName: item.institutionName,
        status: statusOf(item.status),
        lastSuccessfulSyncAt: item.lastSuccessfulSyncAt?.toISOString() ?? null,
        accounts: accounts
            .filter((a) => a.itemRecordId === item.id)
            .map((a) => ({
                plaidAccountId: a.plaidAccountId,
                name: a.name,
                mask: a.mask,
                type: a.type,
                subtype: a.subtype,
                syncStatus: a.syncStatus,
                lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
                portfolio: a.portfolioId && a.portfolioName ? { id: a.portfolioId, name: a.portfolioName } : null,
            })),
    }));
}

/** Revokes the connection: its token wiped, its accounts no longer synced. */
async function revokeItem(tx: Executor, userId: string, itemRecordId: string, now: Date) {
    await tx
        .update(plaidItems)
        .set({ status: "revoked", revokedAt: now, accessTokenCiphertext: "", accessTokenIv: "", accessTokenAuthTag: "", updatedAt: now })
        .where(and(eq(plaidItems.id, itemRecordId), eq(plaidItems.userId, userId)));
    await tx
        .update(plaidAccounts)
        .set({ syncStatus: "excluded", updatedAt: now })
        .where(and(eq(plaidAccounts.plaidItemRecordId, itemRecordId), eq(plaidAccounts.userId, userId)));
}

/** Plaid's answers that mean the connection is already gone there. */
const ALREADY_REMOVED = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);

/**
 * Disconnects the user's connection: removed at Plaid (/item/remove, which
 * ends Atlas's access at the institution), then revoked here. Its linked
 * accounts stay, with what was last brought in. Throws PlaidItemNotFoundError
 * for a connection that isn't the user's (or is revoked already), and
 * Plaid's error when Plaid can't be told, leaving it connected to try again.
 */
export async function disconnectPlaidItem(
    userId: string,
    itemId: string,
    {
        config,
        database = db,
        fetchImpl = fetch,
        getAccessToken = getPlaidAccessTokenForUser,
        now = new Date(),
    }: {
        config: PlaidConfig;
        database?: Database;
        fetchImpl?: PlaidFetch;
        getAccessToken?: (itemId: string, userId: string) => Promise<string | undefined>;
        now?: Date;
    },
): Promise<void> {
    const [item] = await database
        .select({ id: plaidItems.id })
        .from(plaidItems)
        .where(and(eq(plaidItems.userId, userId), eq(plaidItems.plaidItemId, itemId), ne(plaidItems.status, "revoked"), isNull(plaidItems.revokedAt)))
        .limit(1);
    if (!item) throw new PlaidItemNotFoundError();

    const accessToken = await getAccessToken(itemId, userId);
    if (accessToken) {
        try {
            await postPlaid({ endpoint: "/item/remove", ...config, fetchImpl, body: { access_token: accessToken } });
        } catch (error) {
            if (!(error instanceof PlaidApiError && error.errorCode && ALREADY_REMOVED.has(error.errorCode))) throw error;
        }
    }
    await database.transaction((tx) => revokeItem(tx, userId, item.id, now));
    forgetPlaidAccessToken(itemId, userId);
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** The parts of a Plaid webhook Atlas reads. */
export interface PlaidWebhookBody {
    webhook_type?: unknown;
    webhook_code?: unknown;
    item_id?: unknown;
    account_id?: unknown;
    error?: unknown;
}

export type PlaidWebhookAction = "sync" | "login-required" | "repaired" | "expiring" | "revoked" | "account-revoked" | "ignored";

/**
 * Acts on a verified webhook: new holdings or transactions sync the
 * connection (`scheduleSync`, after the response); item events change its
 * status. A webhook for a connection Atlas doesn't have (or has revoked) is
 * ignored.
 */
export async function handlePlaidWebhook(
    body: PlaidWebhookBody,
    {
        database = db,
        scheduleSync,
        now = new Date(),
    }: {
        database?: Database;
        scheduleSync: (userId: string, itemId: string) => void;
        now?: Date;
    },
): Promise<{ action: PlaidWebhookAction; connections: number }> {
    const type = typeof body.webhook_type === "string" ? body.webhook_type : "";
    const code = typeof body.webhook_code === "string" ? body.webhook_code : "";
    const itemId = typeof body.item_id === "string" ? body.item_id : "";
    if (!itemId) return { action: "ignored", connections: 0 };

    const items = await database
        .select({ id: plaidItems.id, userId: plaidItems.userId, status: plaidItems.status })
        .from(plaidItems)
        .where(and(eq(plaidItems.plaidItemId, itemId), ne(plaidItems.status, "revoked"), isNull(plaidItems.revokedAt)));
    if (items.length === 0) return { action: "ignored", connections: 0 };

    const setStatus = async (status: string, from: readonly string[]) => {
        await database
            .update(plaidItems)
            .set({ status, updatedAt: now })
            .where(and(inArray(plaidItems.id, items.map((i) => i.id)), inArray(plaidItems.status, [...from])));
    };

    if ((type === "INVESTMENTS_TRANSACTIONS" && (code === "DEFAULT_UPDATE" || code === "HISTORICAL_UPDATE"))
        || (type === "HOLDINGS" && code === "DEFAULT_UPDATE")) {
        const syncable = items.filter((i) => i.status === "active" || i.status === "pending_expiration");
        for (const item of syncable) scheduleSync(item.userId, itemId);
        return { action: syncable.length > 0 ? "sync" : "ignored", connections: syncable.length };
    }
    if (type !== "ITEM") return { action: "ignored", connections: 0 };

    const errorCode = typeof (body.error as { error_code?: unknown } | null)?.error_code === "string"
        ? (body.error as { error_code: string }).error_code
        : "";
    switch (code) {
        case "ERROR":
            if (errorCode !== "ITEM_LOGIN_REQUIRED") return { action: "ignored", connections: 0 };
            await setStatus("login_required", ["active", "pending_expiration"]);
            return { action: "login-required", connections: items.length };
        case "LOGIN_REPAIRED":
            await setStatus("active", ["login_required", "pending_expiration"]);
            return { action: "repaired", connections: items.length };
        case "PENDING_EXPIRATION":
        case "PENDING_DISCONNECT":
            await setStatus("pending_expiration", ["active"]);
            return { action: "expiring", connections: items.length };
        case "USER_PERMISSION_REVOKED":
            await database.transaction(async (tx) => {
                for (const item of items) await revokeItem(tx, item.userId, item.id, now);
            });
            for (const item of items) forgetPlaidAccessToken(itemId, item.userId);
            return { action: "revoked", connections: items.length };
        case "USER_ACCOUNT_REVOKED": {
            const accountId = typeof body.account_id === "string" ? body.account_id : "";
            if (!accountId) return { action: "ignored", connections: 0 };
            await database
                .update(plaidAccounts)
                .set({ syncStatus: "excluded", updatedAt: now })
                .where(and(inArray(plaidAccounts.plaidItemRecordId, items.map((i) => i.id)), eq(plaidAccounts.plaidAccountId, accountId)));
            return { action: "account-revoked", connections: items.length };
        }
        default:
            return { action: "ignored", connections: 0 };
    }
}

/** For the route's log line: the webhook's kind, without its IDs. */
export function webhookKind(body: PlaidWebhookBody): string {
    const type = typeof body.webhook_type === "string" ? body.webhook_type.slice(0, 40) : "?";
    const code = typeof body.webhook_code === "string" ? body.webhook_code.slice(0, 40) : "?";
    return `${type}/${code}`.replace(/[^A-Z_/?]/g, "");
}
