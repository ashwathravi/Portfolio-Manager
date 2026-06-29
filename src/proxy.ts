import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, applyApiSecurity, rateLimitApiRequest } from "@/lib/api/security";
import { isAuthConfigured } from "@/lib/auth/access";

export function proxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    if (!pathname.startsWith("/api/")) {
        return applyPageAuthRedirect(request);
    }

    if (isAuthJsRoute(pathname) || isSessionBackedApiRoute(pathname, request.method)) {
        return NextResponse.next();
    }

    if (isAuthConfigured()) {
        if (hasAuthSessionCookie(request)) {
            return rateLimitApiRequest(request, { userId: null, authRequired: true }) ?? NextResponse.next();
        }

        if (!process.env.INTERNAL_API_SECRET?.trim()) {
            return apiError("Unauthorized", "UNAUTHORIZED", 401);
        }
    }

    return applyApiSecurity(request) ?? NextResponse.next();
}

export const config = {
    matcher: [
        "/api/:path*",
        "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
    ],
};

function applyPageAuthRedirect(request: NextRequest): NextResponse {
    const pathname = request.nextUrl.pathname;
    if (!isAuthConfigured() || pathname === "/login") return NextResponse.next();
    if (hasAuthSessionCookie(request)) return NextResponse.next();

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
}

function isSessionBackedApiRoute(pathname: string, method: string): boolean {
    if (pathname.startsWith("/api/plaid/")) return true;
    if (pathname === "/api/alpha-radar/refresh") return true;
    if (pathname.startsWith("/api/alpha-radar/filers/") && pathname.endsWith("/refresh")) return true;
    if (pathname === "/api/alpha-radar/filers" && method === "POST") return true;
    if (pathname.startsWith("/api/alpha-radar/filers/") && (method === "PATCH" || method === "DELETE")) return true;
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

function hasAuthSessionCookie(request: NextRequest): boolean {
    return request.cookies.getAll().some((cookie) =>
        cookie.name === "authjs.session-token"
        || cookie.name === "__Secure-authjs.session-token"
        || cookie.name.startsWith("authjs.session-token.")
        || cookie.name.startsWith("__Secure-authjs.session-token."),
    );
}
