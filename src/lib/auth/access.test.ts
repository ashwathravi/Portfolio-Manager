import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    authRuntimeMode,
    currentAccessPolicy,
    getLocalDevUserId,
    hasAccessAllowlist,
    hasBlockedDomains,
    isAdmin,
    isBlockedDomain,
    isGoogleProfileAllowed,
    isOpenSignup,
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

    test("opens production to sign-up only with AUTH_OPEN_SIGNUP=1 (launch item i77)", () => {
        const env = {
            NODE_ENV: "production",
            AUTH_SECRET: "secret",
            AUTH_GOOGLE_ID: "client-id",
            AUTH_GOOGLE_SECRET: "client-secret",
        };

        assert.equal(authRuntimeMode({ ...env, AUTH_OPEN_SIGNUP: "1" }), "configured");
        for (const value of ["", "0", "true", "yes"]) {
            assert.equal(authRuntimeMode({ ...env, AUTH_OPEN_SIGNUP: value }), "invalid", value);
        }
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

describe("open sign-up and the block list (launch item i77)", () => {
    const verified = (email: string, hd?: string) => ({ email, email_verified: true, ...(hd ? { hd } : {}) });

    test("AUTH_OPEN_SIGNUP=1 is open sign-up, and nothing else is", () => {
        assert.equal(isOpenSignup({ AUTH_OPEN_SIGNUP: "1" }), true);
        assert.equal(isOpenSignup({ AUTH_OPEN_SIGNUP: " 1 " }), true);
        assert.equal(isOpenSignup({}), false);
        assert.equal(isOpenSignup({ AUTH_OPEN_SIGNUP: "true" }), false);
        assert.equal(currentAccessPolicy({ NODE_ENV: "production", AUTH_OPEN_SIGNUP: "1" }).openSignup, true);
    });

    test("open sign-up lets in any verified Google account, the invite lists aside", () => {
        const policy = { openSignup: true, requireAllowlist: true, allowedEmails: "owner@example.com" };

        assert.equal(isGoogleProfileAllowed(verified("stranger@gmail.com"), policy), true);
        assert.equal(isGoogleProfileAllowed({ email: "stranger@gmail.com", email_verified: false }, policy), false);
        assert.equal(isGoogleProfileAllowed({ email_verified: true }, policy), false);
        assert.equal(isSessionEmailAllowed("stranger@gmail.com", policy), true);
    });

    test("a blocked email or domain is refused at sign-in, whichever rule applies", () => {
        const blocked = { blockedEmails: "Spammer@Gmail.com", blockedDomains: "throwaway.test, abuse.example" };
        for (const rule of [{ openSignup: true }, { allowedDomains: "gmail.com,throwaway.test", requireAllowlist: true }, {}]) {
            const policy = { ...rule, ...blocked };
            assert.equal(isGoogleProfileAllowed(verified("spammer@gmail.com"), policy), false, JSON.stringify(rule));
            assert.equal(isGoogleProfileAllowed(verified(" SPAMMER@gmail.com "), policy), false);
            assert.equal(isGoogleProfileAllowed(verified("anyone@throwaway.test", "throwaway.test"), policy), false);
            // A Workspace whose domain is blocked, under an email on another of its domains.
            assert.equal(isGoogleProfileAllowed(verified("someone@alias.example", "abuse.example"), policy), false);
        }
        assert.equal(isGoogleProfileAllowed(verified("friend@gmail.com"), { openSignup: true, ...blocked }), true);
        // A domain that only ends with a blocked one isn't blocked.
        assert.equal(isGoogleProfileAllowed(verified("someone@notthrowaway.test"), { openSignup: true, ...blocked }), true);
    });

    test("blocking someone ends their session at once, whichever rule applies", () => {
        const blocked = { blockedEmails: "spammer@gmail.com", blockedDomains: "throwaway.test" };
        for (const rule of [{ openSignup: true }, { allowedEmails: "spammer@gmail.com,a@throwaway.test", requireAllowlist: true }]) {
            const policy = { ...rule, ...blocked };
            assert.equal(isSessionEmailAllowed("spammer@gmail.com", policy), false, JSON.stringify(rule));
            assert.equal(isSessionEmailAllowed("a@throwaway.test", policy), false);
        }
        assert.equal(isSessionEmailAllowed("friend@gmail.com", { openSignup: true, ...blocked }), true);
    });

    test("a domain is blocked only when AUTH_BLOCKED_DOMAINS names it exactly", () => {
        const policy = { blockedDomains: " Abuse.example , throwaway.test" };
        assert.equal(hasBlockedDomains(policy), true);
        assert.equal(hasBlockedDomains({ blockedDomains: " , " }), false);
        assert.equal(hasBlockedDomains({}), false);
        assert.equal(isBlockedDomain("abuse.example", policy), true);
        assert.equal(isBlockedDomain(" ABUSE.EXAMPLE ", policy), true);
        assert.equal(isBlockedDomain("sub.abuse.example", policy), false);
        assert.equal(isBlockedDomain("", policy), false);
    });

    test("the block list comes from AUTH_BLOCKED_EMAILS and AUTH_BLOCKED_DOMAINS", () => {
        const policy = currentAccessPolicy({ AUTH_OPEN_SIGNUP: "1", AUTH_BLOCKED_EMAILS: "a@gmail.com", AUTH_BLOCKED_DOMAINS: "throwaway.test" });
        assert.equal(isGoogleProfileAllowed(verified("a@gmail.com"), policy), false);
        assert.equal(isGoogleProfileAllowed(verified("b@throwaway.test"), policy), false);
        assert.equal(isGoogleProfileAllowed(verified("b@gmail.com"), policy), true);
    });
});

describe("isAdmin", () => {
    const configured = {
        NODE_ENV: "production",
        AUTH_SECRET: "secret",
        AUTH_GOOGLE_ID: "client-id",
        AUTH_GOOGLE_SECRET: "client-secret",
        AUTH_ALLOWED_EMAILS: "owner@example.com,friend@example.com",
        AUTH_ADMIN_EMAILS: " Owner@Example.com ",
    };

    test("is only the emails AUTH_ADMIN_EMAILS names, in any case", () => {
        assert.equal(isAdmin("owner@example.com", configured), true);
        assert.equal(isAdmin(" OWNER@example.com ", configured), true);
        assert.equal(isAdmin("friend@example.com", configured), false);
        assert.equal(isAdmin("owner@example.com.evil.test", configured), false);
    });

    test("is nobody when no admin is named", () => {
        assert.equal(isAdmin("owner@example.com", { ...configured, AUTH_ADMIN_EMAILS: undefined }), false);
        assert.equal(isAdmin("owner@example.com", { ...configured, AUTH_ADMIN_EMAILS: " , " }), false);
    });

    test("needs an email", () => {
        assert.equal(isAdmin(undefined, configured), false);
        assert.equal(isAdmin("", { ...configured, AUTH_ADMIN_EMAILS: "," }), false);
        assert.equal(isAdmin(42, configured), false);
    });

    test("is the local developer in the local bypass, and nobody when sign-in is misconfigured", () => {
        const localBypass = { NODE_ENV: "development", AUTH_LOCAL_DEV_BYPASS: "1", AUTH_LOCAL_DEV_USER_ID: "local-user" };
        assert.equal(isAdmin(null, localBypass), true);
        assert.equal(isAdmin("owner@example.com", { ...configured, AUTH_ALLOWED_EMAILS: "" }), false);
    });
});
