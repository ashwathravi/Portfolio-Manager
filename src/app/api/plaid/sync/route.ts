/**
 * POST /api/plaid/sync
 *
 * Syncs one of the signed-in user's linked connections (launch item i44):
 * each picked investment account becomes a portfolio, its holdings and cash
 * replaced with the institution's, its transactions upserted. Called after
 * Link, with the accounts the user picked, and by "Sync now".
 *
 * Body:     { itemId, plaidAccountIds? }
 * Response: 200 { data: { itemId, accounts: [...] } }; 400 INVALID_PLAID_SYNC;
 *           404 PLAID_ITEM_NOT_FOUND; 409 PLAID_LOGIN_REQUIRED or
 *           PLAID_TOKEN_MISSING; 502 PLAID_SYNC_FAILED; 503 PLAID_NOT_CONFIGURED or
 *           PLAID_CONNECTIONS_NOT_STORED;
 *           504 PLAID_SYNC_TIMED_OUT
 */

import { NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/db/connection-options";
import { readJsonBody } from "@/lib/api/body";
import { apiError, internalServerError, logApiEvent } from "@/lib/api/security";
import { requireSessionApiUserScope } from "@/lib/api/session-security";
import { requestIdFrom } from "@/lib/observability/request-id";
import { plaidConnectionsInDatabase } from "@/lib/plaid/server-token-vault";
import { PlaidItemNotFoundError, plaidConfigFromEnv, selectPlaidAccounts, syncPlaidItem } from "@/lib/plaid/sync";
import { plaidSyncSchema } from "@/lib/validators/plaid-sync";

export const dynamic = "force-dynamic";
// Two years of a busy account's history is a few pages from Plaid.
export const maxDuration = 120;

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const config = plaidConfigFromEnv();
    if (!config || !isDatabaseConfigured()) {
        return apiError("Linked accounts can't sync here: Plaid isn't set up.", "PLAID_NOT_CONFIGURED", 503);
    }
    // In local development the token vault can be a file or memory, which
    // keeps no connection to sync (production always uses the database).
    if (!plaidConnectionsInDatabase()) {
        return apiError(
            "Linked accounts can't sync here: Plaid connections aren't kept in the database (set PLAID_TOKEN_STORAGE=postgres).",
            "PLAID_CONNECTIONS_NOT_STORED",
            503,
        );
    }

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return apiError("Invalid sync request", "INVALID_PLAID_SYNC", body.reason === "too-large" ? 413 : 400);
    const parsed = plaidSyncSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(`Invalid sync request: ${parsed.error.issues[0]?.path.join(".") || "body"} ${parsed.error.issues[0]?.message ?? ""}`.trim(), "INVALID_PLAID_SYNC", 400);
    }

    const { userId } = auth.context;
    const { itemId, plaidAccountIds } = parsed.data;
    const requestId = requestIdFrom(request.headers);
    try {
        if (plaidAccountIds) await selectPlaidAccounts(userId, itemId, plaidAccountIds);
        // Within this function's time, with room left to answer.
        const result = await syncPlaidItem(userId, itemId, { config, deadline: Date.now() + (maxDuration - 10) * 1000 });
        logApiEvent("plaid_sync_finished", {
            route: "/api/plaid/sync",
            requestId,
            status: result.status,
            accounts: result.accounts.length,
            userScoped: true,
        });

        if (result.status !== "synced") {
            if (result.status === "login-required") {
                return apiError("Your bank wants you to sign in again before Atlas can sync this connection.", "PLAID_LOGIN_REQUIRED", 409);
            }
            if (result.status === "no-token") {
                return apiError("This connection needs linking again before it can sync.", "PLAID_TOKEN_MISSING", 409);
            }
            if (result.status === "timed-out") {
                return apiError("Your institution took too long to answer. Try again in a few minutes.", "PLAID_SYNC_TIMED_OUT", 504);
            }
            console.warn("Plaid sync failed.", result.error);
            return apiError("Plaid couldn't be reached for this connection. Try again later.", "PLAID_SYNC_FAILED", 502);
        }
        return NextResponse.json({
            data: {
                itemId,
                accounts: result.accounts.map((a) => ({
                    portfolioId: a.portfolioId,
                    name: a.name,
                    created: a.created,
                    positions: a.positions,
                    cashUsd: a.cashUsd,
                    holdingsSkipped: a.holdingsSkipped,
                    costUnknown: a.costUnknown,
                    transactionsAdded: a.transactionsAdded,
                    transactionsUpdated: a.transactionsUpdated,
                    transactionsSkipped: Object.values(a.transactionsSkipped).reduce((sum, n) => sum + (n ?? 0), 0),
                    transactionsPending: a.transactionsPending,
                })),
                overLimit: result.overLimit,
            },
        });
    } catch (error) {
        if (error instanceof PlaidItemNotFoundError) return apiError("Plaid connection not found", "PLAID_ITEM_NOT_FOUND", 404);
        return internalServerError(error, "Unable to sync the linked accounts.", "PLAID_SYNC_FAILED");
    }
}
