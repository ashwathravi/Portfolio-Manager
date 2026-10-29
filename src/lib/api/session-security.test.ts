import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { requireAdminApiUserScope, requireSessionApiUserScope } from "./session-security";
import { resetApiSecurityForTests } from "./security";

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
    AUTH_ALLOWED_EMAILS: "owner@example.com",
};

describe("session-backed API user scope", () => {
    afterEach(() => resetApiSecurityForTests());

    test("limits signed-in users per user, not by the IP they share", async () => {
        const shared = { "x-forwarded-for": "203.0.113.50" };
        const anonymous = { env: configuredEnv, getSession: async () => null };
        const signedIn = {
            env: configuredEnv,
            getSession: async () => ({ user: { id: USER_A }, expires: "2099-01-01T00:00:00.000Z" }),
        };

        // Anonymous callers on the shared IP use up its budget (180 per minute)...
        let last;
        for (let i = 0; i < 181; i++) last = await requireSessionApiUserScope(request(shared), anonymous);
        assert.equal(last?.ok, false);
        if (last && !last.ok) assert.equal(last.response.status, 429);

        // ...but a signed-in user on that IP still gets through.
        const result = await requireSessionApiUserScope(request(shared), signedIn);
        assert.equal(result.ok, true);
    });

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

    test("never accepts the internal secret and a user id header in place of a session", async () => {
        const headers = { "x-api-key": "test-secret", "x-user-id": USER_A };
        const noSessionLookup = async () => {
            throw new Error("incomplete auth must not trigger a session lookup");
        };

        const incomplete = await requireSessionApiUserScope(request(headers), {
            env: { NODE_ENV: "production", AUTH_SECRET: "partial-only", INTERNAL_API_SECRET: "test-secret" },
            getSession: noSessionLookup,
        });
        assert.equal(incomplete.ok, false);
        if (!incomplete.ok) assert.equal(incomplete.response.status, 503);

        const configured = await requireSessionApiUserScope(request(headers), {
            env: { ...configuredEnv, INTERNAL_API_SECRET: "test-secret" },
            getSession: async () => null,
        });
        assert.equal(configured.ok, false);
        if (!configured.ok) assert.equal(configured.response.status, 401);
    });
});

describe("admin-only API user scope", () => {
    afterEach(() => resetApiSecurityForTests());

    const env = { ...configuredEnv, AUTH_ALLOWED_EMAILS: "owner@example.com,friend@example.com", AUTH_ADMIN_EMAILS: "owner@example.com" };
    const sessionFor = (email: string | null) => async () => ({
        user: { id: USER_A, email },
        expires: "2099-01-01T00:00:00.000Z",
    });

    test("lets an admin through as their own user", async () => {
        const result = await requireAdminApiUserScope(request(), { env, getSession: sessionFor("Owner@example.com") });

        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.context.userId, USER_A);
    });

    test("refuses a signed-in user who isn't an admin with 403", async () => {
        const result = await requireAdminApiUserScope(request(), { env, getSession: sessionFor("friend@example.com") });

        assert.equal(result.ok, false);
        if (!result.ok) {
            assert.equal(result.response.status, 403);
            assert.deepEqual(await result.response.json(), { error: "Only an admin can do this.", code: "ADMIN_REQUIRED" });
        }
    });

    test("refuses everyone when no admin is named, and anonymous callers with 401", async () => {
        const noAdmins = { ...env, AUTH_ADMIN_EMAILS: "" };
        const signedIn = await requireAdminApiUserScope(request(), { env: noAdmins, getSession: sessionFor("owner@example.com") });
        const anonymous = await requireAdminApiUserScope(request(), { env, getSession: async () => null });

        assert.equal(signedIn.ok, false);
        if (!signedIn.ok) assert.equal(signedIn.response.status, 403);
        assert.equal(anonymous.ok, false);
        if (!anonymous.ok) assert.equal(anonymous.response.status, 401);
    });

    test("lets the local developer through in the local bypass", async () => {
        const result = await requireAdminApiUserScope(request(), {
            env: { NODE_ENV: "development", AUTH_LOCAL_DEV_BYPASS: "1", AUTH_LOCAL_DEV_USER_ID: USER_A },
            getSession: async () => { throw new Error("no session lookup in the local bypass"); },
        });

        assert.equal(result.ok, true);
    });
});
