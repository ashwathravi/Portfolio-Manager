import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { hostedDomainFromIdToken, isSessionUserAllowed } from "./session-access";

/** An ID token with these claims (unsigned: only the payload is read). */
const idToken = (claims: Record<string, unknown>) =>
    ["header", Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(".");

describe("hostedDomainFromIdToken", () => {
    test("reads Google's hd claim", () => {
        assert.equal(hostedDomainFromIdToken(idToken({ sub: "1", hd: "Abuse.Example" })), "abuse.example");
    });

    test("is empty without one, or for anything that isn't a token", () => {
        assert.equal(hostedDomainFromIdToken(idToken({ sub: "1" })), "");
        assert.equal(hostedDomainFromIdToken(idToken({ hd: 42 })), "");
        assert.equal(hostedDomainFromIdToken(["h", Buffer.from("null").toString("base64url"), "s"].join(".")), "");
        assert.equal(hostedDomainFromIdToken("not-a-token"), "");
        assert.equal(hostedDomainFromIdToken("h.%%%.s"), "");
        assert.equal(hostedDomainFromIdToken(null), "");
        assert.equal(hostedDomainFromIdToken(undefined), "");
    });
});

describe("isSessionUserAllowed (launch item i77)", () => {
    const user = { id: "u-1", email: "someone@alias.example" };

    test("regression: a blocked Workspace ends the session of a user whose email is on another of its domains", async () => {
        // The Codex finding on PR #194: only the email's domain was checked
        // on session reads, so the block applied at the next sign-in only.
        const policy = { openSignup: true, blockedDomains: "abuse.example" };
        assert.equal(await isSessionUserAllowed(user, { policy, workspaceDomains: async () => ["abuse.example"] }), false);
        assert.equal(await isSessionUserAllowed(user, { policy, workspaceDomains: async () => ["fine.example"] }), true);
        assert.equal(await isSessionUserAllowed(user, { policy, workspaceDomains: async () => [] }), true);
    });

    test("the Workspace is read only while a domain is blocked, and only for a session that passed the email check", async () => {
        const reads: string[] = [];
        const workspaceDomains = async (userId: string) => {
            reads.push(userId);
            return ["abuse.example"];
        };

        assert.equal(await isSessionUserAllowed(user, { policy: { openSignup: true }, workspaceDomains }), true);
        assert.equal(await isSessionUserAllowed(user, { policy: { openSignup: true, blockedEmails: "someone@alias.example", blockedDomains: "abuse.example" }, workspaceDomains }), false);
        assert.equal(await isSessionUserAllowed({ email: user.email }, { policy: { openSignup: true, blockedDomains: "abuse.example" }, workspaceDomains }), true);
        assert.deepEqual(reads, []);
    });

    test("a Workspace that can't be read leaves the email check to decide", async (t) => {
        const warn = t.mock.method(console, "warn", () => {});
        const workspaceDomains = async () => { throw new Error("connection refused"); };

        assert.equal(await isSessionUserAllowed(user, { policy: { openSignup: true, blockedDomains: "abuse.example" }, workspaceDomains }), true);
        assert.equal(await isSessionUserAllowed(user, { policy: { openSignup: true, blockedDomains: "alias.example" }, workspaceDomains }), false);
        assert.equal(warn.mock.callCount(), 1);
    });

    test("without open sign-up, the invite list still decides", async () => {
        const workspaceDomains = async () => [];
        const policy = { requireAllowlist: true, allowedEmails: "owner@example.com", blockedDomains: "abuse.example" };
        assert.equal(await isSessionUserAllowed({ id: "u-2", email: "owner@example.com" }, { policy, workspaceDomains }), true);
        assert.equal(await isSessionUserAllowed(user, { policy, workspaceDomains }), false);
    });
});
