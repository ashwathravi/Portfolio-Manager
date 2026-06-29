import { NextResponse } from "next/server";
import { internalServerError, logApiEvent } from "@/lib/api/security";
import { requireSessionApiUserScope } from "@/lib/api/session-security";
import { createPlaidLinkToken, resolvePlaidEnvironment } from "@/lib/plaid/link";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        const environment = resolvePlaidEnvironment(process.env.PLAID_ENV);
        logApiEvent("plaid_link_token_requested", {
            route: "/api/plaid/link-token",
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
            redirectUri: readOptionalEnv("PLAID_REDIRECT_URI"),
            webhook: readOptionalEnv("PLAID_WEBHOOK_URL"),
        });

        logApiEvent("plaid_link_token_created", {
            route: "/api/plaid/link-token",
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
