import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    isStrongTokenKey,
    getPlaidAccessTokenForUser,
    getPlaidAccessToken,
    hasPlaidAccessToken,
    resetPlaidTokenVaultForTests,
    revokePlaidConnectionForUser,
    setPlaidTokenRegistryStoreForTests,
    storePlaidConnection,
    storePlaidAccessToken,
} from "./server-token-vault";
import type { PlaidPublicTokenExchangeResult } from "./types";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

describe("Plaid server token vault", () => {
    afterEach(() => {
        resetPlaidTokenVaultForTests({ clearFile: true });
        delete process.env.PLAID_TOKEN_ENCRYPTION_KEY;
        delete process.env.PLAID_TOKEN_KEY_VERSION;
        delete process.env.PLAID_TOKEN_STORAGE;
        delete process.env.PLAID_TOKEN_VAULT_PATH;
        delete process.env.INTERNAL_API_SECRET;
        setPlaidTokenRegistryStoreForTests(null);
        setNodeEnv(ORIGINAL_NODE_ENV);
    });

    test("falls back to process memory when no encryption key is configured", () => {
        const result = storePlaidAccessToken({
            itemId: "item-memory",
            accessToken: "access-token-memory",
        });

        assert.equal(result.stored, true);
        assert.equal(result.durable, false);
        assert.equal(result.mode, "memory");
        assert.equal(hasPlaidAccessToken("item-memory"), true);
        assert.equal(getPlaidAccessToken("item-memory"), "access-token-memory");
    });

    test("never uses INTERNAL_API_SECRET as the token encryption key", () => {
        process.env.INTERNAL_API_SECRET = "unrelated-service-secret";

        const result = storePlaidAccessToken({
            itemId: "item-no-key",
            accessToken: "access-token-no-key",
        });

        assert.equal(result.durable, false);
        assert.equal(result.mode, "memory");
        assert.match(result.reason ?? "", /PLAID_TOKEN_ENCRYPTION_KEY/);
        assert.doesNotMatch(result.reason ?? "", /INTERNAL_API_SECRET/);
    });

    test("scopes in-memory access tokens by user id", () => {
        storePlaidAccessToken({
            itemId: "item-shared",
            accessToken: "access-token-user-a",
            userId: "11111111-1111-4111-8111-111111111111",
        });
        storePlaidAccessToken({
            itemId: "item-shared",
            accessToken: "access-token-user-b",
            userId: "22222222-2222-4222-8222-222222222222",
        });

        assert.equal(getPlaidAccessToken("item-shared", "11111111-1111-4111-8111-111111111111"), "access-token-user-a");
        assert.equal(getPlaidAccessToken("item-shared", "22222222-2222-4222-8222-222222222222"), "access-token-user-b");
        assert.equal(hasPlaidAccessToken("item-shared"), false);
    });

    test("persists encrypted access tokens when a vault key is configured", () => {
        const vaultPath = join(mkdtempSync(join(tmpdir(), "plaid-vault-")), "vault.json");
        process.env.PLAID_TOKEN_VAULT_PATH = vaultPath;
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-local-encryption-key";

        const result = storePlaidAccessToken({
            itemId: "item-durable",
            accessToken: "access-token-durable",
        });

        assert.equal(result.stored, true);
        assert.equal(result.durable, true);
        assert.equal(result.mode, "encrypted_file");

        const file = readFileSync(vaultPath, "utf8");
        assert.ok(!file.includes("access-token-durable"));

        resetPlaidTokenVaultForTests();
        assert.equal(hasPlaidAccessToken("item-durable"), true);
        assert.equal(getPlaidAccessToken("item-durable"), "access-token-durable");
    });

    test("persists encrypted access tokens separately for each user id", () => {
        const vaultPath = join(mkdtempSync(join(tmpdir(), "plaid-vault-")), "vault.json");
        process.env.PLAID_TOKEN_VAULT_PATH = vaultPath;
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-local-encryption-key";

        storePlaidAccessToken({
            itemId: "item-durable-shared",
            accessToken: "access-token-durable-a",
            userId: "11111111-1111-4111-8111-111111111111",
        });
        storePlaidAccessToken({
            itemId: "item-durable-shared",
            accessToken: "access-token-durable-b",
            userId: "22222222-2222-4222-8222-222222222222",
        });

        const file = readFileSync(vaultPath, "utf8");
        assert.ok(!file.includes("access-token-durable-a"));
        assert.ok(!file.includes("access-token-durable-b"));

        resetPlaidTokenVaultForTests();
        assert.equal(
            getPlaidAccessToken("item-durable-shared", "11111111-1111-4111-8111-111111111111"),
            "access-token-durable-a",
        );
        assert.equal(
            getPlaidAccessToken("item-durable-shared", "22222222-2222-4222-8222-222222222222"),
            "access-token-durable-b",
        );
        assert.equal(hasPlaidAccessToken("item-durable-shared"), false);
    });

    test("refuses in-memory token storage in production", () => {
        setNodeEnv("production");

        const result = storePlaidAccessToken({
            itemId: "item-production",
            accessToken: "access-token-production",
        });

        assert.equal(result.stored, false);
        assert.equal(result.durable, false);
        assert.match(result.reason ?? "", /Production Plaid token storage requires/);
        assert.equal(hasPlaidAccessToken("item-production"), false);
    });

    test("refuses durable storage when DATABASE_URL is unusable", async (t) => {
        const original = process.env.DATABASE_URL;
        t.after(() => {
            if (original === undefined) delete process.env.DATABASE_URL;
            else process.env.DATABASE_URL = original;
        });
        process.env.DATABASE_URL = "[SENSITIVE]";
        process.env.PLAID_TOKEN_STORAGE = "postgres";
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-registry-key";
        setPlaidTokenRegistryStoreForTests(null);

        const result = await storePlaidConnection({
            userId: "11111111-1111-4111-8111-111111111111",
            exchange: plaidExchangeFixture(),
        });

        assert.equal(result.stored, false);
        assert.match(result.reason ?? "", /DATABASE_URL is required/);
    });

    test("stores Plaid connections in the durable registry without plaintext tokens", async () => {
        process.env.PLAID_TOKEN_STORAGE = "postgres";
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-registry-key";
        process.env.PLAID_TOKEN_KEY_VERSION = "test-key-v2";
        const registry = createTestRegistryStore();
        setPlaidTokenRegistryStoreForTests(registry.store);

        const result = await storePlaidConnection({
            userId: "11111111-1111-4111-8111-111111111111",
            exchange: plaidExchangeFixture(),
            now: new Date("2026-05-19T00:00:00Z"),
        });

        assert.equal(result.stored, true);
        assert.equal(result.durable, true);
        assert.equal(result.mode, "postgres");
        assert.equal(registry.connection?.userId, "11111111-1111-4111-8111-111111111111");
        assert.equal(registry.connection?.itemId, "item-registry");
        assert.equal(registry.connection?.keyVersion, "test-key-v2");
        assert.deepEqual(registry.connection?.lastSuccessfulSyncAt, new Date("2026-05-19T00:00:00Z"));
        assert.equal(registry.connection?.accounts.length, 1);
        assert.notEqual(registry.connection?.encryptedToken.ciphertext, "access-token-registry");
        assert.ok(!JSON.stringify(registry.connection).includes("access-token-registry"));

        resetPlaidTokenVaultForTests();
        assert.equal(
            await getPlaidAccessTokenForUser("item-registry", "11111111-1111-4111-8111-111111111111"),
            "access-token-registry",
        );
    });

    test("fails closed when durable registry encryption key is missing", async () => {
        process.env.PLAID_TOKEN_STORAGE = "postgres";
        const registry = createTestRegistryStore();
        setPlaidTokenRegistryStoreForTests(registry.store);

        const result = await storePlaidConnection({
            userId: "11111111-1111-4111-8111-111111111111",
            exchange: plaidExchangeFixture(),
        });

        assert.equal(result.stored, false);
        assert.equal(result.durable, false);
        assert.equal(result.mode, "postgres");
        assert.match(result.reason ?? "", /PLAID_TOKEN_ENCRYPTION_KEY/);
        assert.equal(registry.connection, undefined);
    });

    test("production refuses a key that isn't 32 random bytes, and stores nothing (i69)", async (t) => {
        t.mock.method(console, "error", () => {});
        setNodeEnv("production");
        process.env.PLAID_TOKEN_STORAGE = "postgres";
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "correct horse battery staple";
        const registry = createTestRegistryStore();
        setPlaidTokenRegistryStoreForTests(registry.store);

        const weak = await storePlaidConnection({ userId: "11111111-1111-4111-8111-111111111111", exchange: plaidExchangeFixture() });
        assert.equal(weak.stored, false);
        assert.equal(registry.connection, undefined);

        process.env.PLAID_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
        const strong = await storePlaidConnection({ userId: "11111111-1111-4111-8111-111111111111", exchange: plaidExchangeFixture() });
        assert.equal(strong.stored, true);
        assert.equal(
            await getPlaidAccessTokenForUser("item-registry", "11111111-1111-4111-8111-111111111111"),
            plaidExchangeFixture().accessToken,
        );
    });

    test("a strong token key is 32 bytes or more, base64 or hex", () => {
        assert.equal(isStrongTokenKey(Buffer.alloc(32, 1).toString("base64")), true);
        assert.equal(isStrongTokenKey(Buffer.alloc(32, 1).toString("base64url")), true);
        assert.equal(isStrongTokenKey(Buffer.alloc(32, 1).toString("hex")), true);
        assert.equal(isStrongTokenKey(Buffer.alloc(31, 1).toString("base64")), false);
        assert.equal(isStrongTokenKey(Buffer.alloc(31, 1).toString("hex")), false);
        assert.equal(isStrongTokenKey("test-only-registry-key"), false);
        assert.equal(isStrongTokenKey("correct horse battery staple"), false);
        assert.equal(isStrongTokenKey(""), false);
    });

    test("revokes durable Plaid connections and clears cached access tokens", async () => {
        process.env.PLAID_TOKEN_STORAGE = "postgres";
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = "test-only-registry-key";
        const registry = createTestRegistryStore();
        setPlaidTokenRegistryStoreForTests(registry.store);

        await storePlaidConnection({
            userId: "11111111-1111-4111-8111-111111111111",
            exchange: plaidExchangeFixture(),
        });
        await revokePlaidConnectionForUser({
            itemId: "item-registry",
            userId: "11111111-1111-4111-8111-111111111111",
            now: new Date("2026-05-19T01:00:00Z"),
        });

        assert.deepEqual(registry.revoked, {
            userId: "11111111-1111-4111-8111-111111111111",
            itemId: "item-registry",
            now: new Date("2026-05-19T01:00:00Z"),
        });
        assert.equal(
            await getPlaidAccessTokenForUser("item-registry", "11111111-1111-4111-8111-111111111111"),
            undefined,
        );
    });
});

function setNodeEnv(value: string | undefined): void {
    const env = process.env as Record<string, string | undefined>;
    if (value === undefined) {
        delete env.NODE_ENV;
        return;
    }
    env.NODE_ENV = value;
}

function plaidExchangeFixture(): PlaidPublicTokenExchangeResult {
    return {
        itemId: "item-registry",
        accessToken: "access-token-registry",
        requestId: "request-registry",
        institution: {
            id: "ins_registry",
            name: "Registry Brokerage",
        },
        accounts: [
            {
                plaidAccountId: "account-registry",
                name: "Registry Brokerage",
                officialName: "Registry Brokerage Official",
                mask: "0000",
                type: "investment",
                subtype: "brokerage",
                currentBalance: 125000,
                isoCurrencyCode: "USD",
                institution: {
                    id: "ins_registry",
                    name: "Registry Brokerage",
                },
                capabilities: ["balances", "holdings", "transactions", "investments"],
                verificationStatus: "automatically_verified",
            },
        ],
    };
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
    const state: {
        connection?: TestConnectionInput;
        revoked?: { userId: string; itemId: string; now: Date };
    } = {};

    return {
        get connection() {
            return state.connection;
        },
        get revoked() {
            return state.revoked;
        },
        store: {
            configured: () => true,
            upsertConnection: async (input: TestConnectionInput) => {
                state.connection = input;
            },
            getActiveToken: async () => {
                if (!state.connection || state.revoked) return undefined;
                return {
                    ciphertext: state.connection.encryptedToken.ciphertext,
                    iv: state.connection.encryptedToken.iv,
                    tag: state.connection.encryptedToken.tag,
                    keyVersion: state.connection.keyVersion,
                };
            },
            revokeConnection: async (input: { userId: string; itemId: string; now: Date }) => {
                state.revoked = input;
            },
        },
    };
}
