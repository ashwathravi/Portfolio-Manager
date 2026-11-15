import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { userStorageKey } from "@/lib/storage/user-scope";
import {
    PENDING_PLAID_LINK_KEY,
    clearPendingPlaidLink,
    oauthStateIdFrom,
    plaidRedirectUri,
    readPendingPlaidLink,
    savePendingPlaidLink,
} from "./oauth";
import type { PlaidLinkTokenResponse } from "./types";

class FakeStorage {
    readonly store = new Map<string, string>();
    getItem(key: string) { return this.store.get(key) ?? null; }
    setItem(key: string, value: string) { this.store.set(key, value); }
    removeItem(key: string) { this.store.delete(key); }
}

const TOKEN: PlaidLinkTokenResponse = {
    linkToken: "link-sandbox-oauth",
    expiration: "2026-11-01T04:00:00Z",
    requestId: "request-1",
    environment: "sandbox",
    products: ["investments", "transactions"],
};
const BEFORE_EXPIRY = new Date("2026-11-01T03:59:59Z");

describe("PLAID_REDIRECT_URI", () => {
    test("unset means no redirect URI: OAuth banks open in a pop-up only", () => {
        assert.equal(plaidRedirectUri(undefined, "production"), undefined);
        assert.equal(plaidRedirectUri("  ", "production"), undefined);
    });

    test("is Settings on https, passed to Plaid as written", () => {
        assert.equal(plaidRedirectUri(" https://atlas.example.com/settings ", "production"), "https://atlas.example.com/settings");
        assert.equal(plaidRedirectUri("https://atlas.example.com/settings", "sandbox"), "https://atlas.example.com/settings");
    });

    test("allows http only for localhost in Sandbox", () => {
        assert.equal(plaidRedirectUri("http://localhost:3000/settings", "sandbox"), "http://localhost:3000/settings");
        assert.equal(plaidRedirectUri("http://127.0.0.1:3000/settings", "sandbox"), "http://127.0.0.1:3000/settings");
        assert.throws(() => plaidRedirectUri("http://localhost:3000/settings", "production"), /must use https/);
        assert.throws(() => plaidRedirectUri("http://atlas.example.com/settings", "sandbox"), /must use https/);
        assert.throws(() => plaidRedirectUri("atlas://settings", "sandbox"), /must use https/);
    });

    test("refuses a query, a fragment, another page, or no URL at all", () => {
        assert.throws(() => plaidRedirectUri("https://atlas.example.com/settings?tab=accounts", "production"), /query or a fragment/);
        assert.throws(() => plaidRedirectUri("https://atlas.example.com/settings#accounts", "production"), /query or a fragment/);
        assert.throws(() => plaidRedirectUri("https://atlas.example.com/settings?", "production"), /query or a fragment/);
        assert.throws(() => plaidRedirectUri("https://atlas.example.com/oauth", "production"), /must end in \/settings/);
        assert.throws(() => plaidRedirectUri("https://atlas.example.com/settings/", "production"), /must end in \/settings/);
        assert.throws(() => plaidRedirectUri("https://atlas.example.com", "production"), /must end in \/settings/);
        assert.throws(() => plaidRedirectUri("/settings", "production"), /absolute URL/);
    });
});

describe("oauth_state_id", () => {
    test("is read from the address a bank sends the user back to", () => {
        assert.equal(oauthStateIdFrom("?oauth_state_id=abc-123"), "abc-123");
        assert.equal(oauthStateIdFrom("oauth_state_id=abc-123"), "abc-123");
    });

    test("is absent from an ordinary visit", () => {
        assert.equal(oauthStateIdFrom(""), null);
        assert.equal(oauthStateIdFrom("?tab=accounts"), null);
        assert.equal(oauthStateIdFrom("?oauth_state_id="), null);
    });
});

describe("the Link session waiting on a bank's redirect", () => {
    test("comes back as it was saved, for a new connection or a reconnect", () => {
        const storage = new FakeStorage();
        assert.equal(savePendingPlaidLink(storage, { token: TOKEN }, "user-a"), true);
        assert.deepEqual(readPendingPlaidLink(storage, BEFORE_EXPIRY, "user-a"), { status: "ready", pending: { token: TOKEN } });

        savePendingPlaidLink(storage, { token: { ...TOKEN, products: [] }, itemId: "item-fidelity" }, "user-a");
        assert.deepEqual(readPendingPlaidLink(storage, BEFORE_EXPIRY, "user-a"), {
            status: "ready",
            pending: { token: { ...TOKEN, products: [] }, itemId: "item-fidelity" },
        });
    });

    test("is kept per user, so another account on this browser can't pick it up", () => {
        const storage = new FakeStorage();
        savePendingPlaidLink(storage, { token: TOKEN }, "user-a");
        assert.ok(storage.store.has(userStorageKey(PENDING_PLAID_LINK_KEY, "user-a")));
        assert.deepEqual(readPendingPlaidLink(storage, BEFORE_EXPIRY, "user-b"), { status: "missing" });
    });

    test("is missing when none was saved here, or it was cleared", () => {
        const storage = new FakeStorage();
        assert.deepEqual(readPendingPlaidLink(storage, BEFORE_EXPIRY, "user-a"), { status: "missing" });
        savePendingPlaidLink(storage, { token: TOKEN }, "user-a");
        clearPendingPlaidLink(storage, "user-a");
        assert.deepEqual(readPendingPlaidLink(storage, BEFORE_EXPIRY, "user-a"), { status: "missing" });
        assert.deepEqual(readPendingPlaidLink(null, BEFORE_EXPIRY, "user-a"), { status: "missing" });
    });

    test("expires with its link token, and is removed then", () => {
        const storage = new FakeStorage();
        savePendingPlaidLink(storage, { token: TOKEN }, "user-a");
        assert.deepEqual(readPendingPlaidLink(storage, new Date(TOKEN.expiration), "user-a"), { status: "expired" });
        assert.equal(storage.store.size, 0);
    });

    test("is missing when what's stored isn't one", () => {
        const storage = new FakeStorage();
        const key = userStorageKey(PENDING_PLAID_LINK_KEY, "user-a");
        for (const raw of ["not json", "null", "[]", JSON.stringify({ token: { expiration: TOKEN.expiration } }), JSON.stringify({ token: { linkToken: "", expiration: TOKEN.expiration } })]) {
            storage.setItem(key, raw);
            assert.deepEqual(readPendingPlaidLink(storage, BEFORE_EXPIRY, "user-a"), { status: "missing" }, raw);
        }
    });

    test("can't be saved without storage", () => {
        assert.equal(savePendingPlaidLink(null, { token: TOKEN }, "user-a"), false);
    });
});
