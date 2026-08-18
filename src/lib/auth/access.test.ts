import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    authRuntimeMode,
    getLocalDevUserId,
    isGoogleProfileAllowed,
} from "./access";

describe("Google auth access policy", () => {
    test("allows verified Google profiles when no allowlist is configured", () => {
        assert.equal(
            isGoogleProfileAllowed({
                email: "ashwath@example.com",
                email_verified: true,
            }, {}),
            true,
        );
    });

    test("rejects unverified or missing emails", () => {
        assert.equal(
            isGoogleProfileAllowed({
                email: "ashwath@example.com",
                email_verified: false,
            }, {}),
            false,
        );
        assert.equal(isGoogleProfileAllowed({ email_verified: true }, {}), false);
    });

    test("enforces explicit email allowlists", () => {
        assert.equal(
            isGoogleProfileAllowed({
                email: "ashwath@example.com",
                email_verified: true,
            }, {
                allowedEmails: "ashwath@example.com, teammate@example.com",
            }),
            true,
        );
        assert.equal(
            isGoogleProfileAllowed({
                email: "other@example.com",
                email_verified: true,
            }, {
                allowedEmails: "ashwath@example.com",
            }),
            false,
        );
    });

    test("uses Google's hosted-domain claim for Workspace domain allowlists", () => {
        assert.equal(
            isGoogleProfileAllowed({
                email: "person@example.com",
                email_verified: true,
                hd: "example.com",
            }, {
                allowedDomains: "example.com",
            }),
            true,
        );
        assert.equal(
            isGoogleProfileAllowed({
                email: "person@example.com",
                email_verified: true,
            }, {
                allowedDomains: "example.com",
            }),
            false,
        );
    });
});

describe("Auth runtime configuration", () => {
    test("recognizes a complete Auth.js configuration", () => {
        assert.equal(authRuntimeMode({
            NODE_ENV: "production",
            AUTH_SECRET: "secret",
            AUTH_GOOGLE_ID: "client-id",
            AUTH_GOOGLE_SECRET: "client-secret",
        }), "configured");
    });

    test("rejects partial Auth.js configuration", () => {
        assert.equal(authRuntimeMode({
            NODE_ENV: "development",
            AUTH_SECRET: "secret",
            AUTH_GOOGLE_ID: "client-id",
        }), "invalid");
    });

    test("fails closed when production auth is absent", () => {
        assert.equal(authRuntimeMode({ NODE_ENV: "production" }), "invalid");
    });

    test("allows only an explicit, fixed local fixture principal outside production", () => {
        const env = {
            NODE_ENV: "test",
            AUTH_LOCAL_DEV_BYPASS: "1",
            AUTH_LOCAL_DEV_USER_ID: "fixture-user-a",
        };

        assert.equal(authRuntimeMode(env), "local-bypass");
        assert.equal(getLocalDevUserId(env), "fixture-user-a");
    });

    test("never enables the local fixture principal in production", () => {
        const env = {
            NODE_ENV: "production",
            AUTH_LOCAL_DEV_BYPASS: "1",
            AUTH_LOCAL_DEV_USER_ID: "fixture-user-a",
        };

        assert.equal(authRuntimeMode(env), "invalid");
        assert.equal(getLocalDevUserId(env), null);
    });
});
