import { afterEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";

import {
    applyApiSecurity,
    authenticateApiRequest,
    rateLimitApiRequest,
    readUserId,
    requireApiUserScope,
    requirePortfolioUserScope,
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

    test("requires a user id for scoped portfolio routes when auth is enabled", () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const missing = requirePortfolioUserScope(request({ "x-api-key": "test-secret" }, "/api/portfolio/p/value"));
        assert.equal(missing.ok, false);

        const scoped = requirePortfolioUserScope(request({
            "x-api-key": "test-secret",
            "x-user-id": "11111111-1111-4111-8111-111111111111",
        }, "/api/portfolio/p/value"));
        assert.equal(scoped.ok, true);
        if (scoped.ok) assert.equal(scoped.context.userId, "11111111-1111-4111-8111-111111111111");
    });

    test("requires user scope for provider-backed API actions", () => {
        assert.equal(requireApiUserScope(request()).ok, false);

        const scoped = requireApiUserScope(request({
            "x-user-id": "11111111-1111-4111-8111-111111111111",
        }, "/api/plaid/link-token"));

        assert.equal(scoped.ok, true);
        if (scoped.ok) {
            assert.equal(scoped.context.authRequired, false);
            assert.equal(scoped.context.userId, "11111111-1111-4111-8111-111111111111");
        }
    });

    test("ignores malformed user ids", () => {
        assert.equal(readUserId(request({ "x-user-id": "not-a-uuid" })), null);
    });

    test("returns 429 with retry-after when a route exceeds its fixed window", () => {
        mock.timers.enable({ apis: ["Date"], now: 0 });
        const limitedRequest = request({ "x-forwarded-for": "203.0.113.9" }, "/api/market-data/search");
        for (let i = 0; i < 30; i++) {
            assert.equal(rateLimitApiRequest(limitedRequest), undefined);
        }

        const response = rateLimitApiRequest(limitedRequest);
        assert.ok(response);
        assert.equal(response.status, 429);
        assert.equal(response.headers.get("Retry-After"), "60");
    });

    test("applyApiSecurity composes auth and rate limiting", () => {
        process.env.INTERNAL_API_SECRET = "test-secret";
        process.env.API_RATE_LIMIT_DISABLED = "1";

        const unauthorized = applyApiSecurity(request());
        assert.ok(unauthorized);
        assert.equal(unauthorized.status, 401);
        assert.equal(applyApiSecurity(request({ "x-api-key": "test-secret" })), undefined);
    });
});
