import { NextResponse } from "next/server";

import type { AuthEnvironment } from "@/lib/auth/access";
import {
    clientIpAddress,
    createMemoryRateLimitStore,
    getRateLimitStore,
    rateLimitRouteKey,
    setRateLimitStoreForTests,
    type RateLimitRule,
} from "@/lib/api/rate-limit";

export interface ApiAuthContext {
    userId: string | null;
    authRequired: boolean;
}

interface AuthSuccess {
    ok: true;
    context: ApiAuthContext;
}

interface AuthFailure {
    ok: false;
    response: NextResponse;
}

type ApiRequestLike = {
    headers: Headers;
    nextUrl?: { pathname?: string };
    url?: string;
};


export async function applyApiSecurity(
    request: ApiRequestLike,
    env: AuthEnvironment = process.env,
): Promise<NextResponse | undefined> {
    const auth = authenticateApiRequest(request, env);
    if (!auth.ok) return auth.response;

    return rateLimitApiRequest(request, auth.context);
}

export function authenticateApiRequest(
    request: ApiRequestLike,
    env: AuthEnvironment = process.env,
): AuthSuccess | AuthFailure {
    const configuredSecret = env.INTERNAL_API_SECRET?.trim();
    const authRequired = Boolean(configuredSecret) || env.NODE_ENV === "production";

    if (!authRequired) {
        return { ok: true, context: { userId: null, authRequired: false } };
    }

    if (!configuredSecret) {
        return {
            ok: false,
            response: apiError("API authentication is not configured.", "API_AUTH_NOT_CONFIGURED", 503),
        };
    }

    const token = readAuthToken(request);
    if (!token || !safeEqual(token, configuredSecret)) {
        return {
            ok: false,
            response: apiError("Unauthorized", "UNAUTHORIZED", 401),
        };
    }

    // The internal secret identifies a service, never a user: user-scoped
    // routes take their user from the Auth.js session only.
    return { ok: true, context: { userId: null, authRequired: true } };
}

export function apiError(
    error: string,
    code: string,
    status: number,
    init?: ResponseInit,
): NextResponse {
    return NextResponse.json({ error, code }, { ...init, status });
}

export function internalServerError(
    error: unknown,
    userMessage = "Internal server error",
    code = "INTERNAL_SERVER_ERROR",
): NextResponse {
    console.error(userMessage, error);
    return apiError(userMessage, code, 500);
}

export function logApiEvent(event: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
    const cleanFields = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    console.info(JSON.stringify({
        event,
        ...cleanFields,
        timestamp: new Date().toISOString(),
    }));
}

export function providerRateLimitError(retryAfterSeconds: number): NextResponse {
    return apiError(
        "Rate limit exceeded. Please retry later.",
        "RATE_LIMITED",
        429,
        { headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) } },
    );
}

/**
 * Applies the route's limits through the shared store (Upstash in deployed
 * environments). One check per key: callers that already know the user pass
 * skipIp so a signed-in request costs a single Redis round trip.
 */
export async function rateLimitApiRequest(
    request: ApiRequestLike,
    authContext: ApiAuthContext = { userId: null, authRequired: false },
    options: { skipIp?: boolean } = {},
): Promise<NextResponse | undefined> {
    if (process.env.API_RATE_LIMIT_DISABLED === "1") return undefined;

    const route = rateLimitRouteKey(pathnameFor(request));
    const { ip, user } = rulesFor(route);
    const store = getRateLimitStore();

    if (!options.skipIp) {
        const decision = await store.consume(`ip:${route}:${clientIpAddress(request.headers)}`, ip);
        if (!decision.allowed) return rateLimitResponse(decision.retryAfterSeconds);
    }

    if (authContext.userId) {
        const decision = await store.consume(`user:${route}:${authContext.userId}`, user);
        if (!decision.allowed) return rateLimitResponse(decision.retryAfterSeconds);
    }

    return undefined;
}

export function resetApiSecurityForTests(): void {
    setRateLimitStoreForTests(createMemoryRateLimitStore());
}

function rateLimitResponse(retryAfterSeconds: number): NextResponse {
    return apiError(
        "Too many requests. Please retry later.",
        "RATE_LIMITED",
        429,
        { headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
    );
}

function rulesFor(route: string): { ip: RateLimitRule; user: RateLimitRule } {
    if (route.startsWith("/api/auth/")) {
        // Sign-in, callback and session endpoints: enough for normal use,
        // too few for credential stuffing or callback floods.
        return {
            ip: { limit: 30, windowSeconds: 60 },
            user: { limit: 60, windowSeconds: 60 },
        };
    }

    if (route.startsWith("/api/cron/")) {
        // Vercel Cron calls once a day; anything more is someone guessing
        // the secret.
        return {
            ip: { limit: 10, windowSeconds: 60 },
            user: { limit: 10, windowSeconds: 60 },
        };
    }

    if (route.includes("/market-data/search") || route.includes("/alpha-radar/memory/search")) {
        return {
            ip: { limit: 30, windowSeconds: 60 },
            user: { limit: 60, windowSeconds: 60 },
        };
    }

    if (route.includes("/plaid/") || route.includes("/alpha-radar/refresh")) {
        return {
            ip: { limit: 20, windowSeconds: 60 },
            user: { limit: 30, windowSeconds: 60 },
        };
    }

    if (route.includes("/market-data/")) {
        return {
            ip: { limit: 120, windowSeconds: 60 },
            user: { limit: 240, windowSeconds: 60 },
        };
    }

    return {
        ip: { limit: 180, windowSeconds: 60 },
        user: { limit: 300, windowSeconds: 60 },
    };
}

function readAuthToken(request: ApiRequestLike): string | null {
    const bearer = request.headers.get("authorization")?.trim();
    if (bearer?.toLowerCase().startsWith("bearer ")) {
        return bearer.slice(7).trim() || null;
    }

    return (
        request.headers.get("x-api-key")?.trim()
        || request.headers.get("x-internal-api-secret")?.trim()
        || null
    );
}

function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

function pathnameFor(request: ApiRequestLike): string {
    if (request.nextUrl?.pathname) return request.nextUrl.pathname;
    if (!request.url) return "/api";
    try {
        return new URL(request.url).pathname;
    } catch {
        return "/api";
    }
}

