import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    authRuntimeMode,
    getLocalDevUserId,
    hasAccessAllowlist,
    isGoogleProfileAllowed,
    isSessionEmailAllowed,
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

describe("isSessionEmailAllowed", () => {
    test("ends a session whose email has left the invite list", () => {
        const policy = { allowedEmails: "owner@example.com", requireAllowlist: true };
        assert.equal(isSessionEmailAllowed("owner@example.com", policy), true);
        assert.equal(isSessionEmailAllowed(" Owner@Example.com ", policy), true);
        assert.equal(isSessionEmailAllowed("former@example.com", policy), false);
    });

    test("checks the domain list against the email's domain", () => {
        const policy = { allowedDomains: "example.com", requireAllowlist: true };
        assert.equal(isSessionEmailAllowed("anyone@example.com", policy), true);
        assert.equal(isSessionEmailAllowed("someone@example.com.evil.test", policy), false);
        assert.equal(isSessionEmailAllowed("someone@evil.test", policy), false);
    });

    test("requires both lists to match when both are set", () => {
        const policy = { allowedEmails: "a@example.com", allowedDomains: "example.com", requireAllowlist: true };
        assert.equal(isSessionEmailAllowed("a@example.com", policy), true);
        assert.equal(isSessionEmailAllowed("b@example.com", policy), false);
    });

    test("denies sessions without an email whenever a list is set", () => {
        assert.equal(isSessionEmailAllowed(undefined, { allowedEmails: "a@example.com" }), false);
        assert.equal(isSessionEmailAllowed("", { allowedDomains: "example.com" }), false);
    });

    test("follows the open or invite-only rule when no list is set", () => {
        assert.equal(isSessionEmailAllowed("anyone@example.com", { requireAllowlist: false }), true);
        assert.equal(isSessionEmailAllowed("anyone@example.com", { requireAllowlist: true }), false);
    });
});
