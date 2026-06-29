import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import { resetApiSecurityForTests } from "@/lib/api/security";
import { proxy } from "./proxy";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function request(headers: Record<string, string> = {}, pathname = "/api/market-data/quote"): NextRequest {
    return {
        headers: new Headers(headers),
        nextUrl: { pathname, search: "" },
        url: `https://atlas.test${pathname}`,
        cookies: { getAll: () => [] },
    } as unknown as NextRequest;
}

function requestWithCookies(
    pathname = "/api/market-data/quote",
    cookies: Array<{ name: string; value: string }> = [],
): NextRequest {
    return {
        headers: new Headers(),
        nextUrl: { pathname, search: "" },
        url: `https://atlas.test${pathname}`,
        cookies: { getAll: () => cookies },
    } as unknown as NextRequest;
}

function pageRequest(pathname = "/settings", cookies: Array<{ name: string; value: string }> = []): NextRequest {
    return {
        headers: new Headers({ accept: "text/html" }),
        nextUrl: { pathname, search: "" },
        url: `https://atlas.test${pathname}`,
        cookies: { getAll: () => cookies },
    } as unknown as NextRequest;
}

describe("API proxy security", () => {
    afterEach(() => {
        delete process.env.INTERNAL_API_SECRET;
        delete process.env.API_RATE_LIMIT_DISABLED;
        delete process.env.AUTH_SECRET;
        delete process.env.AUTH_GOOGLE_ID;
        delete process.env.AUTH_GOOGLE_SECRET;
        resetApiSecurityForTests();
        mock.timers.reset();
    });

    test("rejects API requests without the internal API secret when configured", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = proxy(request());

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
            error: "Unauthorized",
            code: "UNAUTHORIZED",
        });
    });

    test("allows authorized API requests through to route handlers", () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = proxy(request({
            "x-api-key": "test-secret",
            "x-user-id": USER_ID,
        }));

        assert.equal(response.status, 200);
    });

    test("lets Auth.js own its callback routes", () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = proxy(request({}, "/api/auth/signin/google"));

        assert.equal(response.status, 200);
    });

    test("redirects page requests to login when Google auth is configured and no session cookie exists", () => {
        process.env.AUTH_SECRET = "auth-secret";
        process.env.AUTH_GOOGLE_ID = "google-client-id";
        process.env.AUTH_GOOGLE_SECRET = "google-client-secret";

        const response = proxy(pageRequest("/settings"));

        assert.equal(response.status, 307);
        assert.equal(response.headers.get("location"), "https://atlas.test/login?callbackUrl=%2Fsettings");
    });

    test("allows page requests when auth variables are explicitly blank for E2E", () => {
        process.env.AUTH_SECRET = "";
        process.env.AUTH_GOOGLE_ID = "";
        process.env.AUTH_GOOGLE_SECRET = "";

        const response = proxy(pageRequest("/settings"));

        assert.equal(response.status, 200);
    });

    test("allows page requests with an Auth.js database session cookie", () => {
        process.env.AUTH_SECRET = "auth-secret";
        process.env.AUTH_GOOGLE_ID = "google-client-id";
        process.env.AUTH_GOOGLE_SECRET = "google-client-secret";

        const response = proxy(pageRequest("/settings", [
            { name: "authjs.session-token", value: "opaque-session-token" },
        ]));

        assert.equal(response.status, 200);
    });

    test("allows non-session API requests with an Auth.js session cookie", () => {
        process.env.AUTH_SECRET = "auth-secret";
        process.env.AUTH_GOOGLE_ID = "google-client-id";
        process.env.AUTH_GOOGLE_SECRET = "google-client-secret";

        const response = proxy(requestWithCookies("/api/market-data/quote", [
            { name: "authjs.session-token", value: "opaque-session-token" },
        ]));

        assert.equal(response.status, 200);
    });

    test("rejects non-session API requests without a session cookie when Google auth is configured", async () => {
        process.env.AUTH_SECRET = "auth-secret";
        process.env.AUTH_GOOGLE_ID = "google-client-id";
        process.env.AUTH_GOOGLE_SECRET = "google-client-secret";

        const response = proxy(request({}, "/api/market-data/quote"));

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
            error: "Unauthorized",
            code: "UNAUTHORIZED",
        });
    });

    test("lets session-backed provider routes enforce route-level auth", () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = proxy(request({}, "/api/plaid/link-token"));

        assert.equal(response.status, 200);
    });

    test("rate limits non-session API routes by client IP", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";
        mock.timers.enable({ apis: ["Date"], now: 0 });

        const headers = {
            "x-api-key": "test-secret",
            "x-forwarded-for": "203.0.113.99",
            "x-user-id": USER_ID,
        };
        for (let i = 0; i < 30; i++) {
            assert.equal(proxy(request(headers, "/api/market-data/search")).status, 200);
        }

        const response = proxy(request(headers, "/api/market-data/search"));

        assert.equal(response.status, 429);
        assert.equal(response.headers.get("Retry-After"), "60");
        assert.deepEqual(await response.json(), {
            error: "Too many requests. Please retry later.",
            code: "RATE_LIMITED",
        });
    });
});
