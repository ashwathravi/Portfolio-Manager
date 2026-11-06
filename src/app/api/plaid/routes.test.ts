import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { POST as exchangePublicToken } from "./exchange-public-token/route";
import { POST as createLinkToken } from "./link-token/route";
import { POST as syncPlaid } from "./sync/route";
import { GET as listConnections } from "./connections/route";
import { DELETE as disconnect } from "./connections/[itemId]/route";
import { POST as webhook } from "./webhook/route";
import {
    getPlaidAccessTokenForUser,
    getPlaidAccessToken,
    resetPlaidTokenVaultForTests,
    setPlaidTokenRegistryStoreForTests,
} from "@/lib/plaid/server-token-vault";
import type { PlaidPublicTokenExchangeResult } from "@/lib/plaid/types";
import { resetApiSecurityForTests } from "@/lib/api/security";
import { createMemoryRateLimitStore, setRateLimitStoreForTests, type RateLimitStore } from "@/lib/api/rate-limit";
import { MAX_PLAID_CONNECTIONS_PER_USER } from "@/lib/plaid/connections";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

describe("Plaid API routes", () => {
    afterEach(() => {
        globalThis.fetch = ORIGINAL_FETCH;
        delete process.env.INTERNAL_API_SECRET;
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        delete process.env.PLAID_CLIENT_ID;
        delete process.env.PLAID_SECRET;
        delete process.env.PLAID_ENV;
        delete process.env.PLAID_REDIRECT_URI;
        delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
        delete process.env.PLAID_TOKEN_KEY_VERSION;
        delete process.env.PLAID_TOKEN_STORAGE;
        delete process.env.PLAID_TOKEN_VAULT_PATH;
        if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
        setNodeEnv(ORIGINAL_NODE_ENV);
        setPlaidTokenRegistryStoreForTests(null);
        resetPlaidTokenVaultForTests({ clearFile: true });
        resetApiSecurityForTests();
    });

    test("fails closed when sign-in is not configured", async () => {
        const response = await createLinkToken(new Request("https://atlas.test/api/plaid/link-token", {
            method: "POST",
        }));

        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            error: "Authentication is not configured.",
            code: "AUTH_CONFIGURATION_ERROR",
        });
    });

    test("does not accept the internal secret and a user id header as a session", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = await createLinkToken(new Request("https://atlas.test/api/plaid/link-token", {
            method: "POST",
            headers: { "x-api-key": "test-secret", "x-user-id": USER_ID },
        }));

        assert.equal(response.status, 503);
    });

    test("rate limits repeated Plaid link attempts before provider calls", async (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: 0 });

        const request = () => new Request("https://atlas.test/api/plaid/link-token", {
            method: "POST",
            headers: { "x-forwarded-for": "203.0.113.10" },
        });

        for (let i = 0; i < 20; i++) {
            assert.equal((await createLinkToken(request())).status, 503);
        }

        const response = await createLinkToken(request());

        assert.equal(response.status, 429);
        assert.equal(response.headers.get("Retry-After"), "60");
    });

    test("creates Plaid link tokens with the authenticated user scope", async (t) => {
        t.mock.method(console, "info", () => {});
        configurePlaidEnv();

        const calls: Array<Record<string, unknown>> = [];
        globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
            calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
            return Response.json({
                link_token: "link-route-token",
                expiration: "2026-05-17T10:00:00Z",
                request_id: "request-link-route",
            });
        }) as typeof fetch;

        const response = await createLinkToken(authorizedRequest("/api/plaid/link-token"));
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.linkToken, "link-route-token");
        assert.equal((calls[0].user as { client_user_id: string }).client_user_id, USER_ID);
        assert.ok(!JSON.stringify(body).includes("sandbox-secret"));
    });

    test("gives Link the redirect URI for OAuth banks, and refuses one that can't work before calling Plaid", async (t) => {
        // Launch item i47: the bank sends the user back to Settings.
        t.mock.method(console, "info", () => {});
        const logged = t.mock.method(console, "error", () => {});
        configurePlaidEnv();
        const calls: Array<Record<string, unknown>> = [];
        globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
            calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
            return Response.json({ link_token: "link-route-token", expiration: "2026-11-01T04:00:00Z", request_id: "r" });
        }) as typeof fetch;

        process.env.PLAID_REDIRECT_URI = "https://atlas.test/settings";
        assert.equal((await createLinkToken(authorizedRequest("/api/plaid/link-token"))).status, 200);
        assert.equal(calls[0].redirect_uri, "https://atlas.test/settings");

        process.env.PLAID_REDIRECT_URI = "https://atlas.test/oauth-return";
        const refused = await createLinkToken(authorizedRequest("/api/plaid/link-token"));
        assert.equal(refused.status, 500);
        assert.equal((await refused.json()).code, "PLAID_LINK_TOKEN_FAILED");
        assert.equal(calls.length, 1);
        assert.match(String(logged.mock.calls[0].arguments[1]), /PLAID_REDIRECT_URI must end in \/settings/);
    });

    test("does not leak provider error details to Plaid clients", async (t) => {
        t.mock.method(console, "info", () => {});
        t.mock.method(console, "error", () => {});
        configurePlaidEnv();
        globalThis.fetch = (async () =>
            Response.json({ error_message: "provider secret diagnostic" }, { status: 400 })) as typeof fetch;

        const response = await createLinkToken(authorizedRequest("/api/plaid/link-token"));
        const body = await response.json();

        assert.equal(response.status, 500);
        assert.deepEqual(body, {
            error: "Unable to create Plaid link token.",
            code: "PLAID_LINK_TOKEN_FAILED",
        });
        assert.ok(!JSON.stringify(body).includes("provider secret diagnostic"));
    });

    test("sync fails closed when sign-in is not configured", async () => {
        const response = await syncPlaid(authorizedRequest("/api/plaid/sync", { itemId: "item-route" }));
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "AUTH_CONFIGURATION_ERROR");
    });

    test("sync says linked accounts can't sync without Plaid's keys or a database", async () => {
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
        delete process.env.DATABASE_URL;
        const withoutKeys = await syncPlaid(authorizedRequest("/api/plaid/sync", { itemId: "item-route" }));
        assert.equal(withoutKeys.status, 503);
        assert.equal((await withoutKeys.json()).code, "PLAID_NOT_CONFIGURED");

        configurePlaidEnv();
        const withoutDatabase = await syncPlaid(authorizedRequest("/api/plaid/sync", { itemId: "item-route" }));
        assert.equal(withoutDatabase.status, 503);
        assert.equal((await withoutDatabase.json()).code, "PLAID_NOT_CONFIGURED");
    });

    test("regression: sync says why it can't when Plaid connections aren't kept in the database", async () => {
        // The Codex finding on PR #162: the local file vault keeps only the
        // token, so the sync looked for a connection that was never stored.
        configurePlaidEnv();
        process.env.DATABASE_URL = "postgres://atlas_app:pw@db.example.invalid:6543/postgres";
        const response = await syncPlaid(authorizedRequest("/api/plaid/sync", { itemId: "item-route" }));
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            error: "Linked accounts can't sync here: Plaid connections aren't kept in the database (set PLAID_TOKEN_STORAGE=postgres).",
            code: "PLAID_CONNECTIONS_NOT_STORED",
        });
    });

    test("sync refuses a request that isn't one, before touching the database", async () => {
        configurePlaidEnv();
        process.env.DATABASE_URL = "postgres://atlas_app:pw@db.example.invalid:6543/postgres";
        process.env.PLAID_TOKEN_STORAGE = "postgres";
        for (const body of [{}, { itemId: "has space" }, { itemId: "item-route", plaidAccountIds: "acc" }, { itemId: "item-route", accessToken: "x" }]) {
            const response = await syncPlaid(authorizedRequest("/api/plaid/sync", body));
            assert.equal(response.status, 400, JSON.stringify(body));
            assert.equal((await response.json()).code, "INVALID_PLAID_SYNC");
        }
    });

    test("connections and disconnect say Plaid isn't set up, and refuse an ID that isn't Plaid's", async () => {
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
        delete process.env.DATABASE_URL;
        const list = await listConnections(new Request("https://atlas.test/api/plaid/connections"));
        assert.equal(list.status, 503);
        assert.equal((await list.json()).code, "PLAID_NOT_CONFIGURED");

        configureStoredPlaid();
        const bad = await disconnect(new Request("https://atlas.test/api/plaid/connections/x", { method: "DELETE" }), { params: Promise.resolve({ itemId: "not an id" }) });
        assert.equal(bad.status, 400);
        assert.equal((await bad.json()).code, "INVALID_PLAID_ITEM");
    });

    test("Plaid's webhook is refused without Plaid's signature, before anything is read", async (t) => {
        t.mock.method(console, "info", () => {});
        delete process.env.DATABASE_URL;
        const unconfigured = await webhook(new Request("https://atlas.test/api/plaid/webhook", { method: "POST", body: "{}" }));
        assert.equal(unconfigured.status, 503);

        configureStoredPlaid();
        const unsigned = await webhook(new Request("https://atlas.test/api/plaid/webhook", {
            method: "POST",
            body: JSON.stringify({ webhook_type: "ITEM", webhook_code: "USER_PERMISSION_REVOKED", item_id: "item-route" }),
        }));
        assert.equal(unsigned.status, 401);
        assert.deepEqual(await unsigned.json(), { error: "Webhook not verified", code: "PLAID_WEBHOOK_UNVERIFIED" });

        const tooLarge = await webhook(new Request("https://atlas.test/api/plaid/webhook", { method: "POST", body: "x".repeat(70 * 1024) }));
        assert.equal(tooLarge.status, 413);
    });

    test("update mode needs one of the user's connections", async () => {
        configurePlaidEnv();
        const invalid = await createLinkToken(authorizedRequest("/api/plaid/link-token", { itemId: "not an id" }));
        assert.equal(invalid.status, 400);
        assert.equal((await invalid.json()).code, "INVALID_PLAID_ITEM");
        // No token for that connection under this user: not theirs, or gone.
        const unknown = await createLinkToken(authorizedRequest("/api/plaid/link-token", { itemId: "item-someone-elses" }));
        assert.equal(unknown.status, 404);
        assert.equal((await unknown.json()).code, "PLAID_ITEM_NOT_FOUND");
    });

    test("exchanges public tokens and stores Plaid access tokens under user scope", async (t) => {
        t.mock.method(console, "info", () => {});
        configurePlaidEnv();
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-vault-key";
        process.env.PLAID_TOKEN_VAULT_PATH = join(mkdtempSync(join(tmpdir(), "plaid-route-vault-")), "vault.json");

        globalThis.fetch = (async (url: string | URL | Request) => {
            const endpoint = String(url);
            if (endpoint.endsWith("/item/public_token/exchange")) {
                return Response.json({
                    access_token: "access-route-token",
                    item_id: "item-route",
                    request_id: "request-exchange-route",
                });
            }
            return Response.json({
                accounts: [
                    {
                        account_id: "account-route",
                        name: "Route Brokerage",
                        official_name: "Route Brokerage Official",
                        mask: "0000",
                        type: "investment",
                        subtype: "brokerage",
                        balances: { current: 1200, iso_currency_code: "USD" },
                    },
                ],
            });
        }) as typeof fetch;

        const response = await exchangePublicToken(authorizedRequest("/api/plaid/exchange-public-token", {
            publicToken: "public-route-token",
            selectedAccountIds: ["account-route"],
        }));
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.itemId, "item-route");
        assert.equal(body.accounts.length, 1);
        assert.equal(body.accessTokenStored, true);
        assert.equal(getPlaidAccessToken("item-route", USER_ID), "access-route-token");
        assert.equal(getPlaidAccessToken("item-route"), undefined);
        assert.ok(!JSON.stringify(body).includes("access-route-token"));
    });

    test("exchanges public tokens into the durable Plaid registry when configured", async (t) => {
        t.mock.method(console, "info", () => {});
        configurePlaidEnv();
        process.env.PLAID_TOKEN_STORAGE = "postgres";
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-registry-key";
        const registry = createTestRegistryStore();
        setPlaidTokenRegistryStoreForTests(registry.store);

        globalThis.fetch = (async (url: string | URL | Request) => {
            const endpoint = String(url);
            if (endpoint.endsWith("/item/public_token/exchange")) {
                return Response.json({
                    access_token: "access-route-token",
                    item_id: "item-route",
                    request_id: "request-exchange-route",
                });
            }
            return Response.json({
                accounts: [
                    {
                        account_id: "account-route",
                        name: "Route Brokerage",
                        official_name: "Route Brokerage Official",
                        mask: "0000",
                        type: "investment",
                        subtype: "brokerage",
                        balances: { current: 1200, iso_currency_code: "USD" },
                    },
                ],
            });
        }) as typeof fetch;

        const response = await exchangePublicToken(authorizedRequest("/api/plaid/exchange-public-token", {
            publicToken: "public-route-token",
            selectedAccountIds: ["account-route"],
        }));
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.accessTokenStored, true);
        assert.equal(body.accessTokenStorageMode, "postgres");
        assert.equal(body.accessTokenStorageDurable, true);
        assert.equal(registry.connection?.userId, USER_ID);
        assert.ok(registry.connection?.lastSuccessfulSyncAt instanceof Date);
        assert.ok(!JSON.stringify(registry.connection).includes("access-route-token"));
        resetPlaidTokenVaultForTests();
        assert.equal(await getPlaidAccessTokenForUser("item-route", USER_ID), "access-route-token");
        assert.ok(!JSON.stringify(body).includes("access-route-token"));
    });

    for (const plaidRemoves of [true, false]) {
        test(`regression: a connection that can't be saved is ended at Plaid, not left open without its token (Plaid ${plaidRemoves ? "answers" : "is down"})`, async (t) => {
            t.mock.method(console, "info", () => {});
            const warn = t.mock.method(console, "warn", () => {});
            configurePlaidEnv();
            process.env.PLAID_TOKEN_STORAGE = "postgres";
            process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-registry-key";
            const registry = createTestRegistryStore();
            // As when the account is deleted while the connection is linked:
            // the user row is gone by the time it's saved.
            setPlaidTokenRegistryStoreForTests({
                ...registry.store,
                upsertConnection: async () => { throw new Error("insert violates foreign key constraint"); },
            });
            const removed: string[] = [];
            globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
                const endpoint = String(url);
                if (endpoint.endsWith("/item/public_token/exchange")) {
                    return Response.json({ access_token: "access-route-token", item_id: "item-route", request_id: "r" });
                }
                if (endpoint.endsWith("/item/remove")) {
                    removed.push(JSON.parse(String(init?.body)).access_token);
                    return plaidRemoves
                        ? Response.json({ request_id: "r" })
                        : Response.json({ error_type: "API_ERROR", error_code: "INTERNAL_SERVER_ERROR", error_message: "down" }, { status: 500 });
                }
                return Response.json({ accounts: [] });
            }) as typeof fetch;

            const response = await exchangePublicToken(authorizedRequest("/api/plaid/exchange-public-token", { publicToken: "public-route-token" }));
            const body = await response.json();

            assert.equal(response.status, 503);
            assert.equal(body.code, "PLAID_CONNECTION_NOT_SAVED");
            assert.deepEqual(removed, ["access-route-token"]);
            assert.ok(!JSON.stringify(body).includes("access-route-token"));
            assert.equal(warn.mock.callCount(), plaidRemoves ? 0 : 1);
            assert.ok(!JSON.stringify(warn.mock.calls.map((c) => c.arguments)).includes("access-route-token"));
        });
    }

    // Launch item i77: Plaid charges for each connection, and is called on every sync.
    test("regression (i77): a new bank link is refused once the user has the most connections, before Plaid is asked; reconnecting one still works", async (t) => {
        t.mock.method(console, "info", () => {});
        configurePlaidEnv();
        process.env.PLAID_TOKEN_STORAGE = "postgres";
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-registry-key";
        const registry = createTestRegistryStore();
        setPlaidTokenRegistryStoreForTests(registry.store);
        const endpoints: string[] = [];
        globalThis.fetch = (async (url: string | URL | Request) => {
            const endpoint = String(url);
            endpoints.push(endpoint.slice(endpoint.lastIndexOf("/")));
            if (endpoint.endsWith("/item/public_token/exchange")) {
                return Response.json({ access_token: "access-route-token", item_id: "item-route", request_id: "r" });
            }
            if (endpoint.endsWith("/link/token/create")) {
                return Response.json({ link_token: "link-route-token", expiration: "2026-05-17T10:00:00Z", request_id: "r" });
            }
            return Response.json({ accounts: [] });
        }) as typeof fetch;

        registry.otherConnections = MAX_PLAID_CONNECTIONS_PER_USER - 1;
        assert.equal((await createLinkToken(authorizedRequest("/api/plaid/link-token"))).status, 200);
        assert.equal((await exchangePublicToken(authorizedRequest("/api/plaid/exchange-public-token", { publicToken: "public-route-token" }))).status, 200);

        endpoints.length = 0;
        const refused = await createLinkToken(authorizedRequest("/api/plaid/link-token"));
        assert.equal(refused.status, 409);
        assert.deepEqual(await refused.json(), {
            error: `You can link up to ${MAX_PLAID_CONNECTIONS_PER_USER} institutions. Disconnect one in Settings to link another.`,
            code: "PLAID_CONNECTION_LIMIT",
        });
        assert.deepEqual(endpoints, []);

        // Update mode repairs a connection the user has, so it isn't a new one.
        const reconnect = await createLinkToken(authorizedRequest("/api/plaid/link-token", { itemId: "item-route" }));
        assert.equal(reconnect.status, 200);
    });

    for (const plaidRemoves of [true, false]) {
        test(`regression (i77): a link token used again past the most connections ends the new one at Plaid (Plaid ${plaidRemoves ? "answers" : "is down"})`, async (t) => {
            t.mock.method(console, "info", () => {});
            const warn = t.mock.method(console, "warn", () => {});
            configurePlaidEnv();
            process.env.PLAID_TOKEN_STORAGE = "postgres";
            process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-registry-key";
            const registry = createTestRegistryStore();
            registry.otherConnections = MAX_PLAID_CONNECTIONS_PER_USER;
            setPlaidTokenRegistryStoreForTests(registry.store);
            const removed: string[] = [];
            globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
                const endpoint = String(url);
                if (endpoint.endsWith("/item/public_token/exchange")) {
                    return Response.json({ access_token: "access-route-token", item_id: "item-route", request_id: "r" });
                }
                if (endpoint.endsWith("/item/remove")) {
                    removed.push(JSON.parse(String(init?.body)).access_token);
                    return plaidRemoves
                        ? Response.json({ request_id: "r" })
                        : Response.json({ error_type: "API_ERROR", error_code: "INTERNAL_SERVER_ERROR", error_message: "down" }, { status: 500 });
                }
                return Response.json({ accounts: [] });
            }) as typeof fetch;

            const response = await exchangePublicToken(authorizedRequest("/api/plaid/exchange-public-token", { publicToken: "public-route-token" }));
            const body = await response.json();

            assert.equal(response.status, 409);
            assert.equal(body.code, "PLAID_CONNECTION_LIMIT");
            assert.deepEqual(removed, ["access-route-token"]);
            assert.equal(registry.connection, undefined);
            assert.ok(!JSON.stringify(body).includes("access-route-token"));
            assert.equal(warn.mock.callCount(), plaidRemoves ? 0 : 1);
        });
    }

    test("regression (i77): a connection count that fails still ends the connection at Plaid when it can't be saved", async (t) => {
        t.mock.method(console, "info", () => {});
        const warn = t.mock.method(console, "warn", () => {});
        configurePlaidEnv();
        process.env.PLAID_TOKEN_STORAGE = "postgres";
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-registry-key";
        const registry = createTestRegistryStore();
        // The database gone: neither counting nor saving works.
        setPlaidTokenRegistryStoreForTests({
            ...registry.store,
            countConnections: async () => { throw new Error("connection refused"); },
            upsertConnection: async () => { throw new Error("connection refused"); },
        });
        const removed: string[] = [];
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            const endpoint = String(url);
            if (endpoint.endsWith("/item/public_token/exchange")) {
                return Response.json({ access_token: "access-route-token", item_id: "item-route", request_id: "r" });
            }
            if (endpoint.endsWith("/item/remove")) {
                removed.push(JSON.parse(String(init?.body)).access_token);
                return Response.json({ request_id: "r" });
            }
            return Response.json({ accounts: [] });
        }) as typeof fetch;

        const response = await exchangePublicToken(authorizedRequest("/api/plaid/exchange-public-token", { publicToken: "public-route-token" }));

        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "PLAID_CONNECTION_NOT_SAVED");
        assert.deepEqual(removed, ["access-route-token"]);
        assert.equal(warn.mock.callCount(), 1);
    });

    test("regression (i77): a bank link past the day's is refused before Plaid is asked", async (t) => {
        t.mock.method(console, "info", () => {});
        configurePlaidEnv();
        setRateLimitStoreForTests(quotaSpentStore("bankLinks"));
        let called = false;
        globalThis.fetch = (async () => {
            called = true;
            return Response.json({});
        }) as typeof fetch;

        const response = await createLinkToken(authorizedRequest("/api/plaid/link-token"));

        assert.equal(response.status, 429);
        assert.equal(response.headers.get("Retry-After"), String(3 * 60 * 60));
        assert.deepEqual(await response.json(), {
            error: "You can open bank linking up to 10 times a day. Try again in about 3 hours.",
            code: "DAILY_QUOTA_REACHED",
        });
        assert.equal(called, false);
    });

    test("regression (i77): a sync past the day's is refused before the database is touched", async () => {
        configureStoredPlaid();
        setRateLimitStoreForTests(quotaSpentStore("bankSyncs"));

        const response = await syncPlaid(authorizedRequest("/api/plaid/sync", { itemId: "item-route" }));

        assert.equal(response.status, 429);
        const body = await response.json();
        assert.equal(body.code, "DAILY_QUOTA_REACHED");
        assert.match(body.error, /^You can sync your linked accounts up to 20 times a day\. They still sync every night\./);
    });

    test("regression (i77): a sync that isn't one, or can't happen here, doesn't spend the day's", async () => {
        let spent = 0;
        const memory = createMemoryRateLimitStore();
        setRateLimitStoreForTests({
            kind: "memory",
            consume: (key, rule) => {
                if (key.startsWith("quota:")) spent += 1;
                return memory.consume(key, rule);
            },
        });
        configurePlaidEnv();
        assert.equal((await syncPlaid(authorizedRequest("/api/plaid/sync", { itemId: "item-route" }))).status, 503);
        configureStoredPlaid();
        assert.equal((await syncPlaid(authorizedRequest("/api/plaid/sync", { itemId: "has space" }))).status, 400);
        assert.equal(spent, 0);
    });
});

// Signs in as the fixed local-bypass principal (non-production only) and
// configures Plaid sandbox credentials.
function configurePlaidEnv(): void {
    process.env.AUTH_LOCAL_DEV_BYPASS = "1";
    process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
    process.env.PLAID_CLIENT_ID = "client-id";
    process.env.PLAID_SECRET = "sandbox-secret";
    process.env.PLAID_ENV = "sandbox";
}

// Plaid set up, with its connections kept in a (never contacted) database.
function configureStoredPlaid(): void {
    configurePlaidEnv();
    process.env.DATABASE_URL = "postgres://atlas_app:pw@db.example.invalid:6543/postgres";
    process.env.PLAID_TOKEN_STORAGE = "postgres";
}

// The day's `quota` already spent, with three hours until the next day's.
function quotaSpentStore(quota: string): RateLimitStore {
    const memory = createMemoryRateLimitStore();
    return {
        kind: "memory",
        consume: (key, rule) => key.startsWith(`quota:${quota}:`)
            ? Promise.resolve({ allowed: false, retryAfterSeconds: 3 * 60 * 60 })
            : memory.consume(key, rule),
    };
}

function authorizedRequest(pathname: string, body?: unknown): Request {
    return new Request(`https://atlas.test${pathname}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

function setNodeEnv(value: string | undefined): void {
    const env = process.env as Record<string, string | undefined>;
    if (value === undefined) {
        delete env.NODE_ENV;
        return;
    }
    env.NODE_ENV = value;
}

function createTestRegistryStore() {
    type TestConnectionInput = {
        userId: string;
        itemId: string;
        institutionId: string;
        institutionName: string;
        encryptedToken: {
            iv: string;
            tag: string;
            ciphertext: string;
        };
        keyVersion: string;
        accounts: PlaidPublicTokenExchangeResult["accounts"];
        lastSuccessfulSyncAt: Date;
        now: Date;
    };
    const state: { connection?: TestConnectionInput; otherConnections: number } = { otherConnections: 0 };

    return {
        get connection() {
            return state.connection;
        },
        /** Connections the user already has besides the one a test links. */
        set otherConnections(n: number) {
            state.otherConnections = n;
        },
        store: {
            configured: () => true,
            upsertConnection: async (input: TestConnectionInput) => {
                state.connection = input;
            },
            getActiveToken: async () => {
                if (!state.connection) return undefined;
                return {
                    ciphertext: state.connection.encryptedToken.ciphertext,
                    iv: state.connection.encryptedToken.iv,
                    tag: state.connection.encryptedToken.tag,
                    keyVersion: state.connection.keyVersion,
                };
            },
            revokeConnection: async () => {},
            countConnections: async () => (state.connection ? 1 : 0) + state.otherConnections,
        },
    };
}
