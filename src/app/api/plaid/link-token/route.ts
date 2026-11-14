import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api/body";
import { consumeDailyQuota } from "@/lib/api/daily-quota";
import { apiError, internalServerError, logApiEvent } from "@/lib/api/security";
import { requestIdFrom } from "@/lib/observability/request-id";
import { requireSessionApiUserScope } from "@/lib/api/session-security";
import { MAX_PLAID_CONNECTIONS_PER_USER, plaidConnectionLimitMessage } from "@/lib/plaid/connections";
import { createPlaidLinkToken, resolvePlaidEnvironment } from "@/lib/plaid/link";
import { plaidRedirectUri } from "@/lib/plaid/oauth";
import { countPlaidConnectionsForUser, getPlaidAccessTokenForUser } from "@/lib/plaid/server-token-vault";
import { plaidIdSchema } from "@/lib/validators/plaid-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/plaid/link-token: a token for Plaid Link. With `{ itemId }`, one
 * of the user's connections, Link opens in update mode to sign in to it
 * again (launch item i45) instead of linking a new institution.
 *
 * A new link is refused with 409 PLAID_CONNECTION_LIMIT once the user has
 * MAX_PLAID_CONNECTIONS_PER_USER, and either kind with 429
 * DAILY_QUOTA_REACHED past the day's bank links (launch item i77).
 */
export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    // No body (a new link) is fine; one that names a connection must be valid.
    const body = await readJsonBody(request, 1024);
    const requestedItem = body.ok ? (body.value as { itemId?: unknown } | null)?.itemId : undefined;
    let accessToken: string | undefined;
    if (requestedItem !== undefined) {
        const itemId = plaidIdSchema.safeParse(requestedItem);
        if (!itemId.success) return apiError("Invalid connection", "INVALID_PLAID_ITEM", 400);
        accessToken = await getPlaidAccessTokenForUser(itemId.data, auth.context.userId);
        if (!accessToken) return apiError("Plaid connection not found", "PLAID_ITEM_NOT_FOUND", 404);
    }

    try {
        const newLink = accessToken === undefined;
        if (newLink && (await countPlaidConnectionsForUser(auth.context.userId)) >= MAX_PLAID_CONNECTIONS_PER_USER) {
            return apiError(plaidConnectionLimitMessage(), "PLAID_CONNECTION_LIMIT", 409);
        }
        const overQuota = await consumeDailyQuota(auth.context.userId, "bankLinks");
        if (overQuota) return overQuota;

        const environment = resolvePlaidEnvironment(process.env.PLAID_ENV);
        logApiEvent("plaid_link_token_requested", {
            route: "/api/plaid/link-token",
            requestId: requestIdFrom(request.headers),
            environment,
            userScoped: true,
        });

        const token = await createPlaidLinkToken({
            credentials: plaidCredentialsFromEnv(),
            environment,
            clientUserId: auth.context.userId,
            clientName: readOptionalEnv("PLAID_CLIENT_NAME") ?? "Atlas Wealth",
            products: readListEnv("PLAID_PRODUCTS", ["investments", "transactions"]),
            countryCodes: readListEnv("PLAID_COUNTRY_CODES", ["US"]),
            // Where an OAuth bank sends the user back (launch item i47).
            redirectUri: plaidRedirectUri(process.env.PLAID_REDIRECT_URI, environment),
            webhook: readOptionalEnv("PLAID_WEBHOOK_URL"),
            accessToken,
        });

        logApiEvent("plaid_link_token_created", {
            route: "/api/plaid/link-token",
            requestId: requestIdFrom(request.headers),
            environment,
            userScoped: true,
        });

        return NextResponse.json(token);
    } catch (error) {
        return internalServerError(error, "Unable to create Plaid link token.", "PLAID_LINK_TOKEN_FAILED");
    }
}

function plaidCredentialsFromEnv() {
    return {
        clientId: readRequiredEnv("PLAID_CLIENT_ID"),
        secret: readRequiredEnv("PLAID_SECRET"),
    };
}

function readRequiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function readOptionalEnv(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value || undefined;
}

function readListEnv(name: string, fallback: string[]): string[] {
    const value = process.env[name];
    if (!value) return fallback;
    const entries = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    return entries.length > 0 ? entries : fallback;
}
