import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    authRuntimeMode,
    getLocalDevUserId,
    hasAccessAllowlist,
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

    test("denies every profile when an invite list is required but none is set", () => {
        const profile = { email: "ashwath@example.com", email_verified: true };

        assert.equal(isGoogleProfileAllowed(profile, { requireAllowlist: true }), false);
        assert.equal(isGoogleProfileAllowed(profile, { requireAllowlist: true, allowedEmails: " , " }), false);
        assert.equal(
            isGoogleProfileAllowed(profile, { requireAllowlist: true, allowedEmails: "ashwath@example.com" }),
            true,
        );
        assert.equal(
            isGoogleProfileAllowed(
                { ...profile, hd: "example.com" },
                { requireAllowlist: true, allowedDomains: "example.com" },
            ),
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
            AUTH_ALLOWED_EMAILS: "owner@example.com",
        }), "configured");
    });

    test("fails closed in production when no invite list is set", () => {
        const env = {
            NODE_ENV: "production",
            AUTH_SECRET: "secret",
            AUTH_GOOGLE_ID: "client-id",
            AUTH_GOOGLE_SECRET: "client-secret",
        };

        assert.equal(authRuntimeMode(env), "invalid");
        assert.equal(authRuntimeMode({ ...env, AUTH_ALLOWED_EMAILS: "  " }), "invalid");
        assert.equal(authRuntimeMode({ ...env, AUTH_ALLOWED_DOMAINS: "example.com" }), "configured");
    });

    test("keeps open sign-in available outside production", () => {
        assert.equal(authRuntimeMode({
            NODE_ENV: "development",
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

describe("hasAccessAllowlist", () => {
    test("is true when either list has an entry", () => {
        assert.equal(hasAccessAllowlist({ AUTH_ALLOWED_EMAILS: "a@example.com" }), true);
        assert.equal(hasAccessAllowlist({ AUTH_ALLOWED_DOMAINS: "example.com" }), true);
    });

    test("ignores empty and whitespace-only lists", () => {
        assert.equal(hasAccessAllowlist({}), false);
        assert.equal(hasAccessAllowlist({ AUTH_ALLOWED_EMAILS: "", AUTH_ALLOWED_DOMAINS: " , " }), false);
    });
});
