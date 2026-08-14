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
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        setNodeEnv(ORIGINAL_NODE_ENV);
        resetApiSecurityForTests();
        mock.timers.reset();
    });

    test("keeps the health route public when production auth is unavailable", async () => {
        setNodeEnv("production");

        const response = await proxy(apiRequest({}, "/api/health"));

        assert.equal(response.status, 200);
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
            "x-user-id": USER_ID,
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

    test("rejects a forged Auth.js cookie when no verified session exists", () => {
        configureAuth();

        const response = handleVerifiedRequest(pageRequest("/settings", null, [
            { name: "authjs.session-token", value: "opaque-session-token" },
        ]));

        assert.equal(response.status, 307);
        assert.equal(response.headers.get("location"), "https://atlas.test/login?callbackUrl=%2Fsettings");
    });

    test("allows page requests only when Auth.js supplied a verified user", () => {
        configureAuth();

        const response = handleVerifiedRequest(pageRequest("/settings", USER_ID));

        assert.equal(response.status, 200);
    });

    test("does not exclude dotted application paths from the proxy matcher", () => {
        const pageMatcher = config.matcher[1];

        assert.ok(!pageMatcher.includes(".*\\..*"));
        assert.equal(pageMatcher, "/((?!_next/).*)");
    });

    test("rejects a forged cookie on non-session API routes", async () => {
        configureAuth();

        const response = handleVerifiedRequest(apiRequest(
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

    test("allows non-session API routes for a verified session user", () => {
        configureAuth();

        const response = handleVerifiedRequest(apiRequest({}, "/api/market-data/quote", USER_ID));

        assert.equal(response.status, 200);
    });

    test("preserves validated internal-service authentication", () => {
        configureAuth();
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = handleVerifiedRequest(apiRequest({
            "x-api-key": "test-secret",
            "x-user-id": USER_ID,
        }));

        assert.equal(response.status, 200);
    });

    test("delegates only exact route-authenticated API method/path pairs", async () => {
        configureAuth();

        const delegated = [
            ["/api/plaid/link-token", "POST"],
            ["/api/plaid/exchange-public-token", "POST"],
            ["/api/portfolios/count", "GET"],
            ["/api/portfolio/00000000-0000-4000-8000-000000000001/value", "GET"],
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

        const futurePlaidRoute = handleVerifiedRequest(apiRequest(
            {},
            "/api/plaid/future-route",
            null,
            [],
            "POST",
        ));
        assert.equal(futurePlaidRoute.status, 401);

        const wrongMethod = handleVerifiedRequest(apiRequest(
            {},
            "/api/portfolios/count",
            null,
            [],
            "POST",
        ));
        assert.equal(wrongMethod.status, 401);
    });

    test("rate limits non-session API routes by client IP", async () => {
        configureAuth();
        mock.timers.enable({ apis: ["Date"], now: 0 });

        const headers = { "x-forwarded-for": "203.0.113.99" };
        for (let i = 0; i < 30; i++) {
            assert.equal(handleVerifiedRequest(apiRequest(
                headers,
                "/api/market-data/search",
                USER_ID,
            )).status, 200);
        }

        const response = handleVerifiedRequest(apiRequest(
            headers,
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
});
