import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    AuthConfigurationError,
    resolveRequestUserId,
} from "./request-user";

const configuredEnv = {
    NODE_ENV: "production",
    AUTH_SECRET: "auth-secret",
    AUTH_GOOGLE_ID: "google-client-id",
    AUTH_GOOGLE_SECRET: "google-client-secret",
};

describe("server page user scope", () => {
    test("returns the verified Auth.js user id", async () => {
        const userId = await resolveRequestUserId({
            env: configuredEnv,
            getSession: async () => ({
                user: { id: "user-a" },
                expires: "2099-01-01T00:00:00.000Z",
            }),
        });

        assert.equal(userId, "user-a");
    });

    test("returns no principal for an invalid or expired session", async () => {
        const userId = await resolveRequestUserId({
            env: configuredEnv,
            getSession: async () => null,
        });

        assert.equal(userId, null);
    });

    test("does not call Auth.js when configuration is invalid", async () => {
        let sessionLookups = 0;

        await assert.rejects(
            resolveRequestUserId({
                env: { NODE_ENV: "production", AUTH_SECRET: "partial" },
                getSession: async () => {
                    sessionLookups += 1;
                    return null;
                },
            }),
            AuthConfigurationError,
        );
        assert.equal(sessionLookups, 0);
    });

    test("returns the fixed local fixture user without session lookup", async () => {
        let sessionLookups = 0;
        const userId = await resolveRequestUserId({
            env: {
                NODE_ENV: "test",
                AUTH_LOCAL_DEV_BYPASS: "1",
                AUTH_LOCAL_DEV_USER_ID: "fixture-user",
            },
            getSession: async () => {
                sessionLookups += 1;
                return null;
            },
        });

        assert.equal(userId, "fixture-user");
        assert.equal(sessionLookups, 0);
    });
});
