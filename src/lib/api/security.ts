import { NextResponse } from "next/server";

import type { AuthEnvironment } from "@/lib/auth/access";

export interface ApiAuthContext {
    userId: string | null;
    authRequired: boolean;
}

interface AuthSuccess {
    ok: true;
    context: ApiAuthContext;
}

interface ScopedAuthSuccess {
    ok: true;
    context: ApiAuthContext & { userId: string };
}

interface AuthFailure {
    ok: false;
    response: NextResponse;
}

interface RateLimitRule {
    limit: number;
    windowMs: number;
}

interface RateBucket {
    count: number;
    resetAt: number;
}

type ApiRequestLike = {
    headers: Headers;
    nextUrl?: { pathname?: string };
    url?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rateBuckets = new Map<string, RateBucket>();
let nextSweepAt = 0;

export function applyApiSecurity(
    request: ApiRequestLike,
    env: AuthEnvironment = process.env,
): NextResponse | undefined {
    const auth = authenticateApiRequest(request, env);
    if (!auth.ok) return auth.response;

    const rateLimited = rateLimitApiRequest(request, auth.context);
    if (rateLimited) return rateLimited;

    return undefined;
}

export function authenticateApiRequest(
    request: ApiRequestLike,
    env: AuthEnvironment = process.env,
): AuthSuccess | AuthFailure {
    const configuredSecret = env.INTERNAL_API_SECRET?.trim();
    const authRequired = Boolean(configuredSecret) || env.NODE_ENV === "production";
    const userId = readUserId(request);

    if (!authRequired) {
        return { ok: true, context: { userId, authRequired: false } };
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

    return { ok: true, context: { userId, authRequired: true } };
}

export function requirePortfolioUserScope(request: ApiRequestLike): AuthSuccess | AuthFailure {
    const auth = authenticateApiRequest(request);
    if (!auth.ok) return auth;

    if (auth.context.authRequired && !auth.context.userId) {
        return {
            ok: false,
            response: apiError("User scope is required.", "USER_SCOPE_REQUIRED", 401),
        };
    }

    return auth;
}

export function requireApiUserScope(request: ApiRequestLike): ScopedAuthSuccess | AuthFailure {
    const auth = authenticateApiRequest(request);
    if (!auth.ok) return auth;

    if (!auth.context.userId) {
        return {
            ok: false,
            response: apiError("User scope is required.", "USER_SCOPE_REQUIRED", 401),
        };
    }

    return {
        ok: true,
        context: { ...auth.context, userId: auth.context.userId },
    };
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

export function rateLimitApiRequest(
    request: ApiRequestLike,
    authContext: ApiAuthContext = { userId: readUserId(request), authRequired: false },
    options: { skipIp?: boolean } = {},
): NextResponse | undefined {
    if (process.env.API_RATE_LIMIT_DISABLED === "1") return undefined;

    const pathname = pathnameFor(request);
    const { ip, user } = rulesFor(pathname);
    if (!options.skipIp) {
        const ipKey = `ip:${pathname}:${clientIp(request)}`;
        const ipResult = consumeRateBucket(ipKey, ip);
        if (!ipResult.allowed) return rateLimitResponse(ipResult.retryAfterSeconds);
    }

    if (authContext.userId) {
        const userKey = `user:${pathname}:${authContext.userId}`;
        const userResult = consumeRateBucket(userKey, user);
        if (!userResult.allowed) return rateLimitResponse(userResult.retryAfterSeconds);
    }

    return undefined;
}

export function readUserId(request: ApiRequestLike): string | null {
    const value = request.headers.get("x-user-id")?.trim();
    return value && UUID_RE.test(value) ? value : null;
}

export function resetApiSecurityForTests(): void {
    rateBuckets.clear();
    nextSweepAt = 0;
}

function rateLimitResponse(retryAfterSeconds: number): NextResponse {
    return apiError(
        "Too many requests. Please retry later.",
        "RATE_LIMITED",
        429,
        { headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
    );
}

function rulesFor(pathname: string): { ip: RateLimitRule; user: RateLimitRule } {
    if (pathname.includes("/market-data/search") || pathname.includes("/alpha-radar/memory/search")) {
        return {
            ip: { limit: 30, windowMs: 60_000 },
            user: { limit: 60, windowMs: 60_000 },
        };
    }

    if (pathname.includes("/plaid/") || pathname.includes("/alpha-radar/refresh")) {
        return {
            ip: { limit: 20, windowMs: 60_000 },
            user: { limit: 30, windowMs: 60_000 },
        };
    }

    if (pathname.includes("/market-data/")) {
        return {
            ip: { limit: 120, windowMs: 60_000 },
            user: { limit: 240, windowMs: 60_000 },
        };
    }

    return {
        ip: { limit: 180, windowMs: 60_000 },
        user: { limit: 300, windowMs: 60_000 },
    };
}

function consumeRateBucket(key: string, rule: RateLimitRule): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    sweepExpiredBuckets(now);

    const existing = rateBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
        rateBuckets.set(key, { count: 1, resetAt: now + rule.windowMs });
        return { allowed: true };
    }

    if (existing.count >= rule.limit) {
        return {
            allowed: false,
            retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
        };
    }

    existing.count += 1;
    return { allowed: true };
}

function sweepExpiredBuckets(now: number): void {
    if (now < nextSweepAt) return;
    nextSweepAt = now + 60_000;
    for (const [key, bucket] of rateBuckets) {
        if (bucket.resetAt <= now) rateBuckets.delete(key);
    }
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

function clientIp(request: ApiRequestLike): string {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
