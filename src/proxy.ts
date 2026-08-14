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

type VerifiedRequest = NextRequest & { auth?: Session | null };

const PUBLIC_ASSET_PATHS = new Set([
    "/favicon.ico",
    "/file.svg",
    "/globe.svg",
    "/next.svg",
    "/vercel.svg",
    "/window.svg",
]);

const verifiedAuthProxy = auth((request: NextAuthRequest, event: NextFetchEvent) => {
    void event;
    return handleVerifiedRequest(request);
});

export async function proxy(request: NextRequest, event?: NextFetchEvent): Promise<Response> {
    const pathname = request.nextUrl.pathname;
    if (isPublicRoute(pathname)) return NextResponse.next();

    const mode = authRuntimeMode();
    if (mode === "invalid") {
        if (pathname.startsWith("/api/") && process.env.INTERNAL_API_SECRET?.trim()) {
            return applyRequestSecurity(request, null);
        }
        return authConfigurationError();
    }
    if (mode === "local-bypass") {
        return applyRequestSecurity(request, getLocalDevUserId());
    }
    if (isSessionBackedApiRoute(pathname, request.method)) {
        return NextResponse.next();
    }

    const response = await verifiedAuthProxy(request, event as NextFetchEvent);
    return response ?? NextResponse.next();
}

export function handleVerifiedRequest(request: VerifiedRequest): NextResponse {
    return applyRequestSecurity(request, request.auth?.user?.id?.trim() || null);
}

export const config = {
    matcher: [
        "/api/:path*",
        "/((?!_next/).*)",
    ],
};

function applyRequestSecurity(request: NextRequest, userId: string | null): NextResponse {
    const pathname = request.nextUrl.pathname;
    if (!pathname.startsWith("/api/")) return applyPageAuth(request, userId);

    if (isSessionBackedApiRoute(pathname, request.method)) {
        return NextResponse.next();
    }

    if (userId) {
        return rateLimitApiRequest(request, { userId, authRequired: true }) ?? NextResponse.next();
    }

    if (isAuthConfigured() && !process.env.INTERNAL_API_SECRET?.trim()) {
        return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    return applyApiSecurity(request) ?? NextResponse.next();
}

function applyPageAuth(request: NextRequest, userId: string | null): NextResponse {
    if (userId) return NextResponse.next();

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
        "callbackUrl",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
}

function isPublicRoute(pathname: string): boolean {
    return pathname === "/login"
        || pathname === "/api/health"
        || PUBLIC_ASSET_PATHS.has(pathname)
        || isAuthJsRoute(pathname);
}

function isSessionBackedApiRoute(pathname: string, method: string): boolean {
    if (pathname === "/api/plaid/link-token" && method === "POST") return true;
    if (pathname === "/api/plaid/exchange-public-token" && method === "POST") return true;
    if (pathname === "/api/portfolios/count" && method === "GET") return true;
    if (/^\/api\/portfolio\/[^/]+\/value$/.test(pathname) && method === "GET") return true;
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
