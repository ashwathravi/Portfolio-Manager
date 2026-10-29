import { afterEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

import { setErrorReporterForTests } from "@/lib/observability/report-error";

import {
    applyApiSecurity,
    authenticateApiRequest,
    internalServerError,
    logApiEvent,
    rateLimitApiRequest,
    resetApiSecurityForTests,
} from "./security";

function request(headers: Record<string, string> = {}, pathname = "/api/market-data/quote") {
    return {
        headers: new Headers(headers),
        nextUrl: { pathname },
        url: `https://atlas.test${pathname}`,
    };
}

describe("API security helpers", () => {
    afterEach(() => {
        delete process.env.INTERNAL_API_SECRET;
        delete process.env.API_RATE_LIMIT_DISABLED;
        resetApiSecurityForTests();
        mock.timers.reset();
    });

    test("allows local requests when no internal API secret is configured", () => {
        const result = authenticateApiRequest(request());
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.context.authRequired, false);
            assert.equal(result.context.userId, null);
        }
    });

    test("requires a matching bearer token when an internal API secret is configured", () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        assert.equal(authenticateApiRequest(request()).ok, false);
        assert.equal(authenticateApiRequest(request({ authorization: "Bearer wrong" })).ok, false);
        assert.equal(authenticateApiRequest(request({ authorization: "Bearer test-secret" })).ok, true);
        assert.equal(authenticateApiRequest(request({ "x-api-key": "test-secret" })).ok, true);
    });

    test("never takes a user from the x-user-id header, even with the internal secret", () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const result = authenticateApiRequest(request({
            "x-api-key": "test-secret",
            "x-user-id": "11111111-1111-4111-8111-111111111111",
        }, "/api/portfolio/p/value"));

        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.context.userId, null);
    });

    test("returns 429 with retry-after when a route exceeds its fixed window", async () => {
        mock.timers.enable({ apis: ["Date"], now: 0 });
        const limitedRequest = request({ "x-forwarded-for": "203.0.113.9" }, "/api/market-data/search");
        for (let i = 0; i < 30; i++) {
            assert.equal(await rateLimitApiRequest(limitedRequest), undefined);
        }

        const response = await rateLimitApiRequest(limitedRequest);
        assert.ok(response);
        assert.equal(response.status, 429);
        assert.equal(response.headers.get("Retry-After"), "60");
    });

    test("opens a new window once the old one ends", async () => {
        mock.timers.enable({ apis: ["Date"], now: 0 });
        const limitedRequest = request({ "x-forwarded-for": "203.0.113.10" }, "/api/plaid/link-token");
        for (let i = 0; i < 20; i++) await rateLimitApiRequest(limitedRequest);
        assert.ok(await rateLimitApiRequest(limitedRequest));

        mock.timers.tick(60_000);
        assert.equal(await rateLimitApiRequest(limitedRequest), undefined);
    });

    test("limits a signed-in user's Alpha Radar refreshes to 30 a minute, one filer's included", async () => {
        mock.timers.enable({ apis: ["Date"], now: 0 });
        const signedIn = { userId: "11111111-1111-4111-8111-111111111111", authRequired: true };
        for (const pathname of ["/api/alpha-radar/refresh", "/api/alpha-radar/filers/0001067983/refresh"]) {
            const refresh = request({}, pathname);
            for (let i = 0; i < 30; i++) {
                assert.equal(await rateLimitApiRequest(refresh, signedIn, { skipIp: true }), undefined, pathname);
            }
            assert.equal((await rateLimitApiRequest(refresh, signedIn, { skipIp: true }))?.status, 429, pathname);
        }
    });

    test("can be switched off for load tests", async () => {
        process.env.API_RATE_LIMIT_DISABLED = "1";
        const limitedRequest = request({ "x-forwarded-for": "203.0.113.11" }, "/api/plaid/link-token");
        for (let i = 0; i < 25; i++) {
            assert.equal(await rateLimitApiRequest(limitedRequest), undefined);
        }
    });

    test("applyApiSecurity composes auth and rate limiting", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";
        process.env.API_RATE_LIMIT_DISABLED = "1";

        const unauthorized = await applyApiSecurity(request());
        assert.ok(unauthorized);
        assert.equal(unauthorized.status, 401);
        assert.equal(await applyApiSecurity(request({ "x-api-key": "test-secret" })), undefined);
    });
});

describe("internalServerError", () => {
    afterEach(() => setErrorReporterForTests(null));

    test("reports the error to Sentry, tagged with the code, and answers a generic 500", async (t) => {
        t.mock.method(console, "error", () => {});
        const reports: Array<{ error: unknown; context: unknown }> = [];
        const flushes: unknown[] = [];
        setErrorReporterForTests({
            capture: (error, context) => { reports.push({ error, context }); },
            afterResponse: (task) => { flushes.push(task); },
        });
        const error = new Error("relation \"holdings\" does not exist");

        const response = internalServerError(error, "Unable to import holdings.", "PORTFOLIO_IMPORT_FAILED");

        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: "Unable to import holdings.", code: "PORTFOLIO_IMPORT_FAILED" });
        assert.deepEqual(reports, [{ error, context: { tags: { code: "PORTFOLIO_IMPORT_FAILED" } } }]);
        assert.equal(flushes.length, 1);
    });
});

describe("logApiEvent", () => {
    test("writes one JSON line and leaves out undefined fields", (t) => {
        const lines: string[] = [];
        t.mock.method(console, "info", (line: string) => { lines.push(line); });

        logApiEvent("portfolio_csv_imported", { route: "/api/portfolio/import", requestId: "pdx1::abc", rows: 3, error: undefined });

        assert.equal(lines.length, 1);
        const entry = JSON.parse(lines[0]);
        assert.equal(entry.event, "portfolio_csv_imported");
        assert.equal(entry.requestId, "pdx1::abc");
        assert.equal(entry.rows, 3);
        assert.ok(!("error" in entry));
    });
});
