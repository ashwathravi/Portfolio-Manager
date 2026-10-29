import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api/body";
import { apiError, internalServerError, logApiEvent } from "@/lib/api/security";
import { requestIdFrom } from "@/lib/observability/request-id";
import { requireSessionApiUserScope } from "@/lib/api/session-security";
import {
    discoveredPlaidAccountFingerprint,
    exchangePlaidPublicToken,
    PlaidApiError,
    postPlaid,
    resolvePlaidEnvironment,
    sanitizePlaidExchangeForClient,
} from "@/lib/plaid/link";
import { plaidConnectionsInDatabase, storePlaidConnection } from "@/lib/plaid/server-token-vault";
import { connectedAccountFingerprints } from "@/lib/plaid/sync";
import type { PlaidLinkMetadata } from "@/lib/plaid/types";
import { PLAID_EXCHANGE_MAX_BYTES, plaidLinkMetadataSchema } from "@/lib/validators/plaid-sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        const read = await readJsonBody(request, PLAID_EXCHANGE_MAX_BYTES);
        if (!read.ok && read.reason === "too-large") {
            return apiError("Request is too large.", "PLAID_EXCHANGE_TOO_LARGE", 413);
        }
        const body: Record<string, unknown> = read.ok && read.value && typeof read.value === "object" && !Array.isArray(read.value)
            ? read.value as Record<string, unknown>
            : {};
        const publicToken = typeof body.publicToken === "string" ? body.publicToken : "";
        if (!publicToken.trim()) {
            return apiError("Plaid public token is required.", "PLAID_PUBLIC_TOKEN_REQUIRED", 400);
        }
        const selectedAccountIds = Array.isArray(body.selectedAccountIds)
            ? body.selectedAccountIds.filter((id: unknown): id is string => typeof id === "string")
            : undefined;
        const existingPlaidAccountIds = Array.isArray(body.existingPlaidAccountIds)
            ? body.existingPlaidAccountIds.filter((id: unknown): id is string => typeof id === "string")
            : [];
        logApiEvent("plaid_public_token_exchange_requested", {
            route: "/api/plaid/exchange-public-token",
            requestId: requestIdFrom(request.headers),
            userScoped: true,
        });
        const credentials = plaidCredentialsFromEnv();
        const environment = resolvePlaidEnvironment(process.env.PLAID_ENV);
        const exchange = await exchangePlaidPublicToken({
            credentials,
            environment,
            publicToken,
            linkMetadata: parsePlaidMetadata(body.metadata),
            products: readListEnv("PLAID_PRODUCTS", ["investments", "transactions"]),
            selectedAccountIds,
        });
        const tokenStorage = await storePlaidConnection({
            exchange,
            userId: auth.context.userId,
        });
        if (!tokenStorage.stored) {
            // Without its token Atlas could never sync this connection or end
            // it (storage not set up, or the account deleted while it was
            // being linked): end it at Plaid now rather than leave its access
            // open.
            try {
                await postPlaid({ endpoint: "/item/remove", environment, credentials, fetchImpl: fetch, body: { access_token: exchange.accessToken } });
            } catch (error) {
                console.warn(
                    "Plaid exchange: couldn't end a connection that wasn't saved.",
                    error instanceof PlaidApiError ? error.errorCode ?? error.name : error instanceof Error ? error.name : "error",
                );
            }
            return apiError("Atlas couldn't save this connection, so it was ended. Try linking it again.", "PLAID_CONNECTION_NOT_SAVED", 503);
        }
        // Accounts the user already has through another connection (the same
        // brokerage linked again, its accounts under new IDs) aren't offered
        // again, or they'd sync twice (launch item i46). Only a hint for the
        // review: picking one is refused again when the pick is saved, so a
        // failed lookup doesn't fail the link.
        let elsewhere = new Set<string>();
        if (plaidConnectionsInDatabase()) {
            try {
                elsewhere = await connectedAccountFingerprints(auth.context.userId, { exceptItemId: exchange.itemId, statuses: ["sync_ready", "awaiting_selection"] });
            } catch (error) {
                console.warn("Plaid exchange: couldn't check for accounts already connected.", error instanceof Error ? error.name : "error");
            }
        }
        const duplicateAccountIds = exchange.accounts
            .filter((account) => elsewhere.has(discoveredPlaidAccountFingerprint(account)))
            .map((account) => account.plaidAccountId);

        logApiEvent("plaid_public_token_exchanged", {
            route: "/api/plaid/exchange-public-token",
            requestId: requestIdFrom(request.headers),
            accountCount: exchange.accounts.length,
            tokenStored: tokenStorage.stored,
            storageMode: tokenStorage.mode,
            userScoped: true,
        });

        return NextResponse.json(
            sanitizePlaidExchangeForClient({
                exchange,
                existingPlaidAccountIds,
                duplicateAccountIds,
                accessTokenStored: tokenStorage.stored,
                accessTokenStorageMode: tokenStorage.mode,
                accessTokenStorageDurable: tokenStorage.durable,
            }),
        );
    } catch (error) {
        return internalServerError(error, "Unable to exchange Plaid public token.", "PLAID_PUBLIC_TOKEN_EXCHANGE_FAILED");
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

function readListEnv(name: string, fallback: string[]): string[] {
    const value = process.env[name];
    if (!value) return fallback;
    const entries = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    return entries.length > 0 ? entries : fallback;
}

/**
 * Link's metadata, or nothing when it isn't what Link sends: Plaid's answer
 * names the institution anyway, and refusing the request would spend the
 * public token, which works once.
 */
function parsePlaidMetadata(value: unknown): PlaidLinkMetadata | undefined {
    const parsed = plaidLinkMetadataSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}
