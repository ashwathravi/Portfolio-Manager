import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { requireSessionApiUserScope } from "./session-security";

const USER_A = "11111111-1111-4111-8111-111111111111";

function request(headers: Record<string, string> = {}) {
    return {
        headers: new Headers(headers),
        nextUrl: { pathname: "/api/portfolios/count" },
        url: "https://atlas.test/api/portfolios/count",
    };
}

const configuredEnv = {
    NODE_ENV: "production",
    AUTH_SECRET: "auth-secret",
    AUTH_GOOGLE_ID: "google-client-id",
    AUTH_GOOGLE_SECRET: "google-client-secret",
};

describe("session-backed API user scope", () => {
    test("rejects a forged Auth.js cookie when Auth.js resolves no session", async () => {
        const result = await requireSessionApiUserScope(
            request({ cookie: "authjs.session-token=opaque-session-token" }),
            {
                env: configuredEnv,
                getSession: async () => null,
            },
        );

        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.response.status, 401);
    });

    test("returns only the verified Auth.js session user", async () => {
        const result = await requireSessionApiUserScope(
            request({ "x-user-id": "22222222-2222-4222-8222-222222222222" }),
            {
                env: configuredEnv,
                getSession: async () => ({
                    user: { id: USER_A },
                    expires: "2099-01-01T00:00:00.000Z",
                }),
            },
        );

        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.context.userId, USER_A);
    });

    test("fails closed before session lookup when production auth is incomplete", async () => {
        let sessionLookups = 0;
        const result = await requireSessionApiUserScope(request(), {
            env: {
                NODE_ENV: "production",
                AUTH_SECRET: "partial-only",
            },
            getSession: async () => {
                sessionLookups += 1;
                return null;
            },
        });

        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.response.status, 503);
        assert.equal(sessionLookups, 0);
    });

    test("uses the fixed local fixture principal only in explicit non-production mode", async () => {
        const result = await requireSessionApiUserScope(request(), {
            env: {
                NODE_ENV: "test",
                AUTH_LOCAL_DEV_BYPASS: "1",
                AUTH_LOCAL_DEV_USER_ID: USER_A,
            },
            getSession: async () => null,
        });

        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.context.userId, USER_A);
    });

    test("allows a validated internal principal without enabling browser auth", async () => {
        const result = await requireSessionApiUserScope(
            request({
                "x-api-key": "test-secret",
                "x-user-id": USER_A,
            }),
            {
                env: {
                    NODE_ENV: "production",
                    AUTH_SECRET: "partial-only",
                    INTERNAL_API_SECRET: "test-secret",
                },
                getSession: async () => {
                    throw new Error("partial auth must not trigger a session lookup");
                },
            },
        );

        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.context.userId, USER_A);
    });
});
