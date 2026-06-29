import { NextResponse } from "next/server";
import { apiError, internalServerError, logApiEvent } from "@/lib/api/security";
import { requireSessionApiUserScope } from "@/lib/api/session-security";
import {
    exchangePlaidPublicToken,
    resolvePlaidEnvironment,
    sanitizePlaidExchangeForClient,
} from "@/lib/plaid/link";
import { storePlaidConnection } from "@/lib/plaid/server-token-vault";
import type { PlaidLinkMetadata } from "@/lib/plaid/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => ({}));
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
            userScoped: true,
        });
        const exchange = await exchangePlaidPublicToken({
            credentials: plaidCredentialsFromEnv(),
            environment: resolvePlaidEnvironment(process.env.PLAID_ENV),
            publicToken,
            linkMetadata: parsePlaidMetadata(body.metadata),
            products: readListEnv("PLAID_PRODUCTS", ["investments", "transactions"]),
            selectedAccountIds,
        });
        const tokenStorage = await storePlaidConnection({
            exchange,
            userId: auth.context.userId,
        });
        if (!tokenStorage.stored && process.env.NODE_ENV === "production") {
            return apiError("Plaid token storage is not configured.", "PLAID_TOKEN_STORAGE_NOT_CONFIGURED", 503);
        }

        logApiEvent("plaid_public_token_exchanged", {
            route: "/api/plaid/exchange-public-token",
            accountCount: exchange.accounts.length,
            tokenStored: tokenStorage.stored,
            storageMode: tokenStorage.mode,
            userScoped: true,
        });

        return NextResponse.json(
            sanitizePlaidExchangeForClient({
                exchange,
                existingPlaidAccountIds,
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

function parsePlaidMetadata(value: unknown): PlaidLinkMetadata | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as PlaidLinkMetadata;
}
