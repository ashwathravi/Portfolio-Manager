import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { POST as exchangePublicToken } from "./exchange-public-token/route";
import { POST as createLinkToken } from "./link-token/route";
import {
    getPlaidAccessTokenForUser,
    getPlaidAccessToken,
    resetPlaidTokenVaultForTests,
    setPlaidTokenRegistryStoreForTests,
} from "@/lib/plaid/server-token-vault";
import type { PlaidPublicTokenExchangeResult } from "@/lib/plaid/types";
import { resetApiSecurityForTests } from "@/lib/api/security";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("Plaid API routes", () => {
    afterEach(() => {
        globalThis.fetch = ORIGINAL_FETCH;
        delete process.env.INTERNAL_API_SECRET;
        delete process.env.PLAID_CLIENT_ID;
        delete process.env.PLAID_SECRET;
        delete process.env.PLAID_ENV;
        delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
        delete process.env.PLAID_TOKEN_KEY_VERSION;
        delete process.env.PLAID_TOKEN_STORAGE;
        delete process.env.PLAID_TOKEN_VAULT_PATH;
        setNodeEnv(ORIGINAL_NODE_ENV);
        setPlaidTokenRegistryStoreForTests(null);
        resetPlaidTokenVaultForTests({ clearFile: true });
        resetApiSecurityForTests();
    });

    test("rejects unauthenticated Plaid requests when API auth is enabled", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = await createLinkToken(new Request("https://atlas.test/api/plaid/link-token", {
            method: "POST",
        }));

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
            error: "Unauthorized",
            code: "UNAUTHORIZED",
        });
    });

    test("rejects Plaid requests without a scoped user id", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = await createLinkToken(new Request("https://atlas.test/api/plaid/link-token", {
            method: "POST",
            headers: { "x-api-key": "test-secret" },
        }));

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
            error: "User scope is required.",
            code: "USER_SCOPE_REQUIRED",
        });
    });

    test("rate limits repeated Plaid link attempts before provider calls", async (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: 0 });
        process.env.INTERNAL_API_SECRET = "test-secret";

        const request = () => new Request("https://atlas.test/api/plaid/link-token", {
            method: "POST",
            headers: { "x-forwarded-for": "203.0.113.10" },
        });

        for (let i = 0; i < 20; i++) {
            assert.equal((await createLinkToken(request())).status, 401);
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
});

function configurePlaidEnv(): void {
    process.env.INTERNAL_API_SECRET = "test-secret";
    process.env.PLAID_CLIENT_ID = "client-id";
    process.env.PLAID_SECRET = "sandbox-secret";
    process.env.PLAID_ENV = "sandbox";
}

function authorizedRequest(pathname: string, body?: unknown): Request {
    return new Request(`https://atlas.test${pathname}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": "test-secret",
            "x-user-id": USER_ID,
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
    const state: { connection?: TestConnectionInput } = {};

    return {
        get connection() {
            return state.connection;
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
        },
    };
}
