import type { NextAuthRequest, Session } from "next-auth";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { apiError, applyApiSecurity, rateLimitApiRequest } from "@/lib/api/security";
import {
    authRuntimeMode,
    getLocalDevUserId,
    isAuthConfigured,
} from "@/lib/auth/access";
import { isSchwabIntegrationEnabled } from "@/lib/api/schwab/feature";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/content-security-policy";

type VerifiedRequest = NextRequest & { auth?: Session | null };

/** Lets the request through to the app. */
type Continue = () => NextResponse;

const PUBLIC_ASSET_PATHS = new Set([
    "/favicon.ico",
    "/file.svg",
    "/globe.svg",
    "/next.svg",
    "/vercel.svg",
    "/window.svg",
]);

/**
 * Every request gets a Content-Security-Policy with a fresh script nonce. The
 * request carries a copy to the app, where Next.js reads the nonce and puts it
 * on the scripts it renders; the response carries the policy to the browser.
 */
export async function proxy(request: NextRequest, event?: NextFetchEvent): Promise<Response> {
    const policy = buildContentSecurityPolicy({ nonce: createNonce() });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("content-security-policy", policy);
    const next: Continue = () => NextResponse.next({ request: { headers: requestHeaders } });

    const response = await routeRequest(request, event, next);
    response.headers.set("Content-Security-Policy", policy);
    return response;
}

async function routeRequest(request: NextRequest, event: NextFetchEvent | undefined, next: Continue): Promise<Response> {
    const pathname = request.nextUrl.pathname;
    // Disabled Schwab routes are not found for everyone, signed in or not.
    if (isSchwabRoute(pathname) && !isSchwabIntegrationEnabled()) {
        return apiError("Not found", "NOT_FOUND", 404);
    }
    if (isAuthJsRoute(pathname)) {
        // Public, but limited per IP: sign-in and callbacks are what an
        // attacker would hammer.
        return (await rateLimitApiRequest(request)) ?? next();
    }
    if (isCronRoute(pathname)) {
        // No session: Vercel Cron calls these, and each route checks the
        // CRON_SECRET bearer token itself (src/lib/jobs/cron.ts), even when
        // sign-in is misconfigured. Limited per IP against token guessing.
        return (await rateLimitApiRequest(request)) ?? next();
    }
    if (isProviderWebhookRoute(pathname, request.method)) {
        // No session: Plaid calls it, and the route checks Plaid's signature
        // over the body itself (src/lib/plaid/webhook.ts). Limited per IP.
        return (await rateLimitApiRequest(request)) ?? next();
    }
    if (isPublicRoute(pathname)) return next();

    const mode = authRuntimeMode();
    if (mode === "invalid") {
        if (pathname.startsWith("/api/") && process.env.INTERNAL_API_SECRET?.trim()) {
            return applyRequestSecurity(request, null, next);
        }
        return authConfigurationError();
    }
    if (mode === "local-bypass") {
        return applyRequestSecurity(request, getLocalDevUserId(), next);
    }
    if (isSessionBackedApiRoute(pathname, request.method)) {
        return next();
    }

    // Auth.js rebuilds the response it gets back, keeping its headers, so
    // the request headers forwarded by next() survive.
    const verifiedAuthProxy = auth((verified: NextAuthRequest, verifiedEvent: NextFetchEvent) => {
        void verifiedEvent;
        return handleVerifiedRequest(verified, next);
    });
    const response = await verifiedAuthProxy(request, event as NextFetchEvent);
    return response ?? next();
}

export function handleVerifiedRequest(
    request: VerifiedRequest,
    next: Continue = () => NextResponse.next(),
): Promise<NextResponse> {
    return applyRequestSecurity(request, request.auth?.user?.id?.trim() || null, next);
}

export const config = {
    matcher: [
        "/api/:path*",
        "/((?!_next/).*)",
    ],
};

async function applyRequestSecurity(request: NextRequest, userId: string | null, next: Continue): Promise<NextResponse> {
    const pathname = request.nextUrl.pathname;
    if (!pathname.startsWith("/api/")) return applyPageAuth(request, userId, next);

    if (isSessionBackedApiRoute(pathname, request.method)) {
        return next();
    }

    if (userId) {
        // A signed-in request is limited per user only: one check per call.
        return (await rateLimitApiRequest(request, { userId, authRequired: true }, { skipIp: true }))
            ?? next();
    }

    if (isAuthConfigured() && !process.env.INTERNAL_API_SECRET?.trim()) {
        return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    return (await applyApiSecurity(request)) ?? next();
}

function applyPageAuth(request: NextRequest, userId: string | null, next: Continue): NextResponse {
    if (userId) return next();

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
        "callbackUrl",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
}

function isPublicRoute(pathname: string): boolean {
    return pathname === "/login"
        || pathname === "/privacy"
        || pathname === "/api/health"
        || pathname === "/api/health/ready"
        || PUBLIC_ASSET_PATHS.has(pathname);
}

function isCronRoute(pathname: string): boolean {
    return pathname.startsWith("/api/cron/");
}

function isProviderWebhookRoute(pathname: string, method: string): boolean {
    return pathname === "/api/plaid/webhook" && method === "POST";
}

function isSchwabRoute(pathname: string): boolean {
    return pathname === "/api/auth/schwab" || pathname.startsWith("/api/schwab/");
}

function isSessionBackedApiRoute(pathname: string, method: string): boolean {
    if (pathname === "/api/plaid/link-token" && method === "POST") return true;
    if (pathname === "/api/plaid/exchange-public-token" && method === "POST") return true;
    if (pathname === "/api/plaid/sync" && method === "POST") return true;
    if (pathname === "/api/plaid/connections" && method === "GET") return true;
    if (/^\/api\/plaid\/connections\/[^/]+$/.test(pathname) && method === "DELETE") return true;
    if (pathname === "/api/portfolios/count" && method === "GET") return true;
    if (pathname === "/api/portfolios" && method === "POST") return true;
    if (pathname === "/api/transactions" && method === "POST") return true;
    if (pathname === "/api/transactions/import" && method === "POST") return true;
    if (/^\/api\/transactions\/(?!import$)[^/]+$/.test(pathname) && method === "DELETE") return true;
    if (/^\/api\/portfolios\/(?!count$)[^/]+$/.test(pathname) && (method === "PATCH" || method === "DELETE")) return true;
    if (/^\/api\/portfolio\/[^/]+\/value$/.test(pathname) && method === "GET") return true;
    if (pathname === "/api/portfolio/import" && method === "POST") return true;
    if (pathname === "/api/settings" && method === "PUT") return true;
    if (pathname === "/api/ask" && (method === "GET" || method === "POST" || method === "DELETE")) return true;
    if (pathname === "/api/research/watchlist" && method === "GET") return true;
    if (pathname === "/api/research/watchlist/import" && method === "POST") return true;
    if (/^\/api\/research\/watchlist\/(?!import$)[^/]+$/.test(pathname) && method === "PUT") return true;
    if (pathname === "/api/research/journal" && method === "GET") return true;
    if (pathname === "/api/research/journal/import" && method === "POST") return true;
    if (/^\/api\/research\/journal\/(?!import$)[^/]+$/.test(pathname) && method === "PUT") return true;
    if (pathname === "/api/research/theses" && method === "GET") return true;
    if (pathname === "/api/research/theses/import" && method === "POST") return true;
    if (/^\/api\/research\/theses\/(?!import$)[^/]+$/.test(pathname) && method === "PUT") return true;
    if (pathname === "/api/alpha-radar/refresh" && method === "POST") return true;
    if (pathname === "/api/alpha-radar/filers" && method === "POST") return true;
    if (/^\/api\/alpha-radar\/filers\/[^/]+\/refresh$/.test(pathname) && method === "POST") return true;
    if (/^\/api\/alpha-radar\/filers\/[^/]+$/.test(pathname) && (method === "PATCH" || method === "DELETE")) return true;
    return false;
}

function isAuthJsRoute(pathname: string): boolean {
    if (!pathname.startsWith("/api/auth/")) return false;
    const action = pathname.slice("/api/auth/".length).split("/")[0];
    return new Set([
        "callback",
        "csrf",
        "error",
        "providers",
        "session",
        "signin",
        "signout",
        "verify-request",
        "webauthn-options",
    ]).has(action);
}

function authConfigurationError(): NextResponse {
    return apiError(
        "Authentication is not configured.",
        "AUTH_CONFIGURATION_ERROR",
        503,
    );
}
