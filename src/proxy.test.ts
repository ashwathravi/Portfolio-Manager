import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import { resetApiSecurityForTests } from "@/lib/api/security";
import { config, handleVerifiedRequest, proxy } from "./proxy";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function apiRequest(
    headers: Record<string, string> = {},
    pathname = "/api/market-data/quote",
    userId: string | null = null,
    cookies: Array<{ name: string; value: string }> = [],
    method = "GET",
): NextRequest {
    return {
        method,
        headers: new Headers(headers),
        nextUrl: { pathname, search: "" },
        url: `https://atlas.test${pathname}`,
        cookies: { getAll: () => cookies },
        auth: userId
            ? { user: { id: userId }, expires: "2099-01-01T00:00:00.000Z" }
            : null,
    } as unknown as NextRequest;
}

function pageRequest(
    pathname = "/settings",
    userId: string | null = null,
    cookies: Array<{ name: string; value: string }> = [],
): NextRequest {
    return apiRequest({ accept: "text/html" }, pathname, userId, cookies);
}

function configureAuth() {
    process.env.AUTH_SECRET = "auth-secret";
    process.env.AUTH_GOOGLE_ID = "google-client-id";
    process.env.AUTH_GOOGLE_SECRET = "google-client-secret";
    process.env.AUTH_ALLOWED_EMAILS = "owner@example.com";
}

function setNodeEnv(value: string | undefined) {
    const env = process.env as Record<string, string | undefined>;
    if (value === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = value;
}

describe("API proxy security", () => {
    afterEach(() => {
        delete process.env.INTERNAL_API_SECRET;
        delete process.env.API_RATE_LIMIT_DISABLED;
        delete process.env.AUTH_SECRET;
        delete process.env.AUTH_GOOGLE_ID;
        delete process.env.AUTH_GOOGLE_SECRET;
        delete process.env.AUTH_ALLOWED_EMAILS;
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        setNodeEnv(ORIGINAL_NODE_ENV);
        resetApiSecurityForTests();
        mock.timers.reset();
    });

    test("keeps the health routes public when production auth is unavailable", async () => {
        setNodeEnv("production");

        assert.equal((await proxy(apiRequest({}, "/api/health"))).status, 200);
        assert.equal((await proxy(apiRequest({}, "/api/health/ready"))).status, 200);
        assert.equal((await proxy(apiRequest({}, "/api/health/ready/extra"))).status, 503);
    });

    test("answers disabled Schwab routes with 404 before authentication", async () => {
        setNodeEnv("production");
        configureAuth();

        assert.equal((await proxy(apiRequest({}, "/api/schwab/order", null, [], "POST"))).status, 404);
        assert.equal((await proxy(apiRequest({}, "/api/auth/schwab"))).status, 404);
        // Other API routes still require a session.
        assert.equal((await proxy(apiRequest({}, "/api/market-data/quote"))).status, 401);
    });

    test("lets cron routes through without a session, for the route to check CRON_SECRET", async () => {
        setNodeEnv("production");
        configureAuth();

        // Delegated: the proxy answers next(), and the route does its own auth.
        assert.equal((await proxy(apiRequest({}, "/api/cron/daily"))).status, 200);
        // Every other API path still needs a session.
        assert.equal((await proxy(apiRequest({}, "/api/market-data/quote"))).status, 401);
        assert.equal((await proxy(apiRequest({}, "/api/cron"))).status, 401);
        assert.equal((await proxy(apiRequest({}, "/api/cronjobs/daily"))).status, 401);
    });

    test("runs cron routes even when production sign-in is misconfigured", async () => {
        setNodeEnv("production");
        process.env.AUTH_SECRET = "partial-only";

        assert.equal((await proxy(apiRequest({}, "/api/cron/daily"))).status, 200);
        assert.equal((await proxy(apiRequest())).status, 503);
        assert.equal((await proxy(pageRequest("/settings"))).status, 503);
    });

    test("limits repeated cron calls per IP without blocking the daily one", async () => {
        setNodeEnv("production");
        configureAuth();
        mock.timers.enable({ apis: ["Date"], now: 0 });

        const headers = { "x-forwarded-for": "203.0.113.50" };
        for (let i = 0; i < 10; i++) {
            assert.equal((await proxy(apiRequest(headers, "/api/cron/daily"))).status, 200);
        }
        assert.equal((await proxy(apiRequest(headers, "/api/cron/daily"))).status, 429);
        assert.equal((await proxy(apiRequest({ "x-forwarded-for": "203.0.113.51" }, "/api/cron/daily"))).status, 200);

        mock.timers.tick(60_000);
        assert.equal((await proxy(apiRequest(headers, "/api/cron/daily"))).status, 200);
    });

    test("keeps the privacy policy public when production auth is unavailable", async () => {
        setNodeEnv("production");

        assert.equal((await proxy(pageRequest("/privacy"))).status, 200);
        assert.equal((await proxy(pageRequest("/privacy/private"))).status, 503);
    });

    test("serves the privacy policy to signed-out visitors when sign-in is configured", async () => {
        configureAuth();

        const response = await proxy(pageRequest("/privacy"));

        assert.equal(response.status, 200);
        assert.equal(response.headers.get("location"), null);
    });

    test("keeps only exact public asset paths open", async () => {
        setNodeEnv("production");

        assert.equal((await proxy(pageRequest("/file.svg"))).status, 200);
        assert.equal((await proxy(pageRequest("/file.svg/private"))).status, 503);
    });

    test("lets Auth.js own its callback routes", async () => {
        setNodeEnv("production");

        const response = await proxy(apiRequest({}, "/api/auth/signin/google"));

        assert.equal(response.status, 200);
    });

    test("fails closed for protected pages when production auth is absent", async () => {
        setNodeEnv("production");

        const response = await proxy(pageRequest("/settings"));

        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            error: "Authentication is not configured.",
            code: "AUTH_CONFIGURATION_ERROR",
        });
    });

    test("fails closed for protected APIs when production auth is partial", async () => {
        setNodeEnv("production");
        process.env.AUTH_SECRET = "partial-only";

        const response = await proxy(apiRequest());

        assert.equal(response.status, 503);
    });

    test("keeps invalid browser auth closed while allowing validated internal APIs", async () => {
        setNodeEnv("production");
        process.env.AUTH_SECRET = "partial-only";
        process.env.INTERNAL_API_SECRET = "test-secret";

        const pageResponse = await proxy(pageRequest("/settings"));
        const rejectedApiResponse = await proxy(apiRequest());
        const internalApiResponse = await proxy(apiRequest({
            "x-api-key": "test-secret",
        }));

        assert.equal(pageResponse.status, 503);
        assert.equal(rejectedApiResponse.status, 401);
        assert.equal(internalApiResponse.status, 200);
    });

    test("allows only the fixed principal in explicit local fixture mode", async () => {
        setNodeEnv("test");
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;

        const response = await proxy(pageRequest("/settings"));

        assert.equal(response.status, 200);
    });

    test("rejects a forged Auth.js cookie when no verified session exists", async () => {
        configureAuth();

        const response = await handleVerifiedRequest(pageRequest("/settings", null, [
            { name: "authjs.session-token", value: "opaque-session-token" },
        ]));

        assert.equal(response.status, 307);
        assert.equal(response.headers.get("location"), "https://atlas.test/login?callbackUrl=%2Fsettings");
    });

    test("allows page requests only when Auth.js supplied a verified user", async () => {
        configureAuth();

        const response = await handleVerifiedRequest(pageRequest("/settings", USER_ID));

        assert.equal(response.status, 200);
    });

    test("does not exclude dotted application paths from the proxy matcher", async () => {
        const pageMatcher = config.matcher[1];

        assert.ok(!pageMatcher.includes(".*\\..*"));
        assert.equal(pageMatcher, "/((?!_next/).*)");
    });

    test("rejects a forged cookie on non-session API routes", async () => {
        configureAuth();

        const response = await handleVerifiedRequest(apiRequest(
            {},
            "/api/market-data/quote",
            null,
            [{ name: "authjs.session-token", value: "opaque-session-token" }],
        ));

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
            error: "Unauthorized",
            code: "UNAUTHORIZED",
        });
    });

    test("allows non-session API routes for a verified session user", async () => {
        configureAuth();

        const response = await handleVerifiedRequest(apiRequest({}, "/api/market-data/quote", USER_ID));

        assert.equal(response.status, 200);
    });

    test("preserves validated internal-service authentication", async () => {
        configureAuth();
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = await handleVerifiedRequest(apiRequest({
            "x-api-key": "test-secret",
        }));

        assert.equal(response.status, 200);
    });

    test("delegates only exact route-authenticated API method/path pairs", async () => {
        configureAuth();

        const delegated = [
            ["/api/plaid/link-token", "POST"],
            ["/api/plaid/exchange-public-token", "POST"],
            ["/api/portfolios/count", "GET"],
            ["/api/portfolios", "POST"],
            ["/api/portfolios/00000000-0000-4000-8000-000000000001", "PATCH"],
            ["/api/portfolios/00000000-0000-4000-8000-000000000001", "DELETE"],
            ["/api/portfolio/00000000-0000-4000-8000-000000000001/value", "GET"],
            ["/api/portfolio/import", "POST"],
            ["/api/settings", "PUT"],
            ["/api/research/watchlist", "GET"],
            ["/api/research/watchlist/import", "POST"],
            ["/api/research/watchlist/w-coin", "PUT"],
            ["/api/research/journal", "GET"],
            ["/api/research/journal/import", "POST"],
            ["/api/research/journal/seed-journal-1", "PUT"],
            ["/api/research/theses", "GET"],
            ["/api/research/theses/import", "POST"],
            ["/api/research/theses/seed-nvda", "PUT"],
            ["/api/alpha-radar/refresh", "POST"],
            ["/api/alpha-radar/filers", "POST"],
            ["/api/alpha-radar/filers/00000000-0000-4000-8000-000000000001", "PATCH"],
            ["/api/alpha-radar/filers/00000000-0000-4000-8000-000000000001", "DELETE"],
            ["/api/alpha-radar/filers/00000000-0000-4000-8000-000000000001/refresh", "POST"],
        ] as const;

        for (const [pathname, method] of delegated) {
            const response = await proxy(apiRequest({}, pathname, null, [], method));
            assert.equal(response.status, 200, `${method} ${pathname} was not delegated`);
        }

        const futurePlaidRoute = await handleVerifiedRequest(apiRequest(
            {},
            "/api/plaid/future-route",
            null,
            [],
            "POST",
        ));
        assert.equal(futurePlaidRoute.status, 401);

        const wrongMethod = await handleVerifiedRequest(apiRequest(
            {},
            "/api/portfolios/count",
            null,
            [],
            "POST",
        ));
        assert.equal(wrongMethod.status, 401);

        const importWrongMethod = await handleVerifiedRequest(apiRequest(
            {},
            "/api/portfolio/import",
            null,
            [],
            "GET",
        ));
        assert.equal(importWrongMethod.status, 401);

        const settingsWrongMethod = await handleVerifiedRequest(apiRequest(
            {},
            "/api/settings",
            null,
            [],
            "DELETE",
        ));
        assert.equal(settingsWrongMethod.status, 401);

        for (const [pathname, method] of [
            ["/api/portfolios", "GET"],
            ["/api/portfolios/count", "DELETE"],
            ["/api/portfolios/00000000-0000-4000-8000-000000000001", "PUT"],
            ["/api/portfolios/00000000-0000-4000-8000-000000000001/holdings", "PATCH"],
            ["/api/research/watchlist", "POST"],
            ["/api/research/watchlist/import", "GET"],
            ["/api/research/watchlist/w-coin", "GET"],
            ["/api/research/watchlist/w-coin/extra", "PUT"],
            ["/api/research/watchlist/w-coin", "DELETE"],
            ["/api/research/watchlist/import", "PUT"],
            ["/api/research/journal", "DELETE"],
            ["/api/research/journal/import", "PUT"],
            ["/api/research/journal/seed-journal-1", "POST"],
            ["/api/research/journal/seed-journal-1", "DELETE"],
            ["/api/research/theses", "POST"],
            ["/api/research/theses/import", "PUT"],
            ["/api/research/theses/seed-nvda", "DELETE"],
            ["/api/research/theses/seed-nvda/catalysts", "PUT"],
        ] as const) {
            const response = await handleVerifiedRequest(apiRequest({}, pathname, null, [], method));
            assert.equal(response.status, 401, `${method} ${pathname} was delegated`);
        }
    });

    test("rate limits signed-in API calls per user, once per request", async () => {
        configureAuth();
        mock.timers.enable({ apis: ["Date"], now: 0 });

        // Different IPs: a signed-in user's budget follows the user.
        for (let i = 0; i < 60; i++) {
            const response = await handleVerifiedRequest(apiRequest(
                { "x-forwarded-for": `203.0.113.${i}` },
                "/api/market-data/search",
                USER_ID,
            ));
            assert.equal(response.status, 200);
        }

        const response = await handleVerifiedRequest(apiRequest(
            { "x-forwarded-for": "203.0.113.200" },
            "/api/market-data/search",
            USER_ID,
        ));

        assert.equal(response.status, 429);
        assert.equal(response.headers.get("Retry-After"), "60");
        assert.deepEqual(await response.json(), {
            error: "Too many requests. Please retry later.",
            code: "RATE_LIMITED",
        });
    });

    test("rate limits service calls without a user by client IP", async () => {
        configureAuth();
        process.env.INTERNAL_API_SECRET = "test-secret";
        mock.timers.enable({ apis: ["Date"], now: 0 });

        const headers = { "x-forwarded-for": "203.0.113.99", "x-api-key": "test-secret" };
        for (let i = 0; i < 30; i++) {
            assert.equal((await handleVerifiedRequest(apiRequest(headers, "/api/market-data/search"))).status, 200);
        }

        assert.equal((await handleVerifiedRequest(apiRequest(headers, "/api/market-data/search"))).status, 429);
    });

    test("rate limits Auth.js routes by client IP", async () => {
        setNodeEnv("production");
        mock.timers.enable({ apis: ["Date"], now: 0 });

        const headers = { "x-forwarded-for": "198.51.100.7" };
        for (let i = 0; i < 30; i++) {
            assert.equal((await proxy(apiRequest(headers, "/api/auth/callback/google"))).status, 200);
        }

        assert.equal((await proxy(apiRequest(headers, "/api/auth/callback/google"))).status, 429);
        assert.equal(
            (await proxy(apiRequest({ "x-forwarded-for": "198.51.100.8" }, "/api/auth/callback/google"))).status,
            200,
        );
    });

    test("shares one limit across ids in a dynamic path", async () => {
        configureAuth();
        mock.timers.enable({ apis: ["Date"], now: 0 });

        for (let i = 0; i < 300; i++) {
            const portfolioId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
            const response = await handleVerifiedRequest(apiRequest({}, `/api/alpha-radar/filers/${portfolioId}/holdings`, USER_ID));
            assert.equal(response.status, 200);
        }

        const response = await handleVerifiedRequest(
            apiRequest({}, "/api/alpha-radar/filers/00000000-0000-4000-8000-999999999999/holdings", USER_ID),
        );
        assert.equal(response.status, 429);
    });
});

describe("proxy Content-Security-Policy", () => {
    afterEach(() => {
        delete process.env.AUTH_SECRET;
        delete process.env.AUTH_GOOGLE_ID;
        delete process.env.AUTH_GOOGLE_SECRET;
        delete process.env.AUTH_ALLOWED_EMAILS;
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        setNodeEnv(ORIGINAL_NODE_ENV);
        resetApiSecurityForTests();
    });

    function nonceOf(policy: string | null): string | undefined {
        return policy?.match(/'nonce-([^']+)'/)?.[1];
    }

    function localBypass() {
        setNodeEnv("test");
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
    }

    test("hands the app the same policy the browser gets, so rendered scripts carry its nonce", async () => {
        localBypass();

        const response = await proxy(pageRequest("/settings"));
        const policy = response.headers.get("content-security-policy");

        assert.equal(response.status, 200);
        assert.ok(nonceOf(policy), "no nonce in the policy");
        assert.ok(response.headers.get("x-middleware-override-headers")?.split(",").includes("content-security-policy"));
        assert.equal(response.headers.get("x-middleware-request-content-security-policy"), policy);
    });

    test("uses a new nonce for every request", async () => {
        localBypass();

        const first = nonceOf((await proxy(pageRequest("/settings"))).headers.get("content-security-policy"));
        const second = nonceOf((await proxy(pageRequest("/settings"))).headers.get("content-security-policy"));

        assert.ok(first && second);
        assert.notEqual(first, second);
    });

    test("forwards the policy on public pages too", async () => {
        configureAuth();

        const response = await proxy(pageRequest("/login"));

        assert.ok(nonceOf(response.headers.get("x-middleware-request-content-security-policy")));
    });

    test("keeps the request's own headers when forwarding the policy", async () => {
        localBypass();

        const response = await proxy(apiRequest({ accept: "text/html", "x-vercel-id": "pdx1::abc" }, "/settings"));
        const forwarded = response.headers.get("x-middleware-override-headers")?.split(",") ?? [];

        assert.ok(forwarded.includes("x-vercel-id"));
        assert.equal(response.headers.get("x-middleware-request-x-vercel-id"), "pdx1::abc");
    });

    test("sets the policy on redirects and errors as well", async () => {
        configureAuth();
        const login = await proxy(pageRequest("/settings"));
        const notFound = await proxy(apiRequest({}, "/api/schwab/order"));

        assert.equal(login.status, 307);
        assert.ok(nonceOf(login.headers.get("content-security-policy")));
        assert.equal(notFound.status, 404);
        assert.ok(nonceOf(notFound.headers.get("content-security-policy")));
    });

    test("regression: scripts no longer run from 'unsafe-inline'", async () => {
        localBypass();

        const policy = (await proxy(pageRequest("/settings"))).headers.get("content-security-policy") ?? "";
        const scriptSrc = policy.split("; ").find((part) => part.startsWith("script-src ")) ?? "";

        assert.ok(scriptSrc.includes("'strict-dynamic'"));
        assert.ok(!scriptSrc.includes("'unsafe-inline'"));
    });
});
