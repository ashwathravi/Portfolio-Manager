import { describe, test } from "node:test";
import assert from "node:assert";
import {
    connectedPlaidAccountMatchesDiscovered,
    createPlaidLinkToken,
    exchangePlaidPublicToken,
    plaidAccountToConnectedAccount,
    plaidBaseUrl,
    sanitizePlaidExchangeForClient,
} from "./link";
import type { PlaidFetch } from "./link";

const credentials = {
    clientId: "client-id",
    secret: "sandbox-secret",
};

describe("Plaid Link helpers", () => {
    test("creates a Plaid link token without exposing credentials", async () => {
        const token = await createPlaidLinkToken({
            credentials,
            clientUserId: "user@example.com",
            fetchImpl: mockPlaidFetch((url, body) => {
                assert.strictEqual(url, `${plaidBaseUrl("sandbox")}/link/token/create`);
                assert.strictEqual(body.client_id, "client-id");
                assert.strictEqual(body.secret, "sandbox-secret");
                assert.strictEqual((body.user as { client_user_id: string }).client_user_id, "user@example.com");
                assert.deepStrictEqual(body.products, ["investments", "transactions"]);
                assert.deepStrictEqual(body.country_codes, ["US"]);
                return {
                    link_token: "link-sandbox-real",
                    expiration: "2026-05-16T09:00:00Z",
                    request_id: "request-link",
                };
            }),
        });

        assert.strictEqual(token.linkToken, "link-sandbox-real");
        assert.deepStrictEqual(token.products, ["investments", "transactions"]);
        assert.ok(!JSON.stringify(token).includes("sandbox-secret"));
    });

    test("rejects missing Plaid client user ids", async () => {
        await assert.rejects(
            () => createPlaidLinkToken({
                credentials,
                clientUserId: " ",
                fetchImpl: mockPlaidFetch(() => ({})),
            }),
            /Plaid client user id is required/,
        );
    });

    test("exchanges a public token, fetches accounts, and filters selected accounts", async () => {
        const calls: string[] = [];
        const exchange = await exchangePlaidPublicToken({
            credentials,
            publicToken: "public-sandbox-real",
            selectedAccountIds: ["acc-growth"],
            linkMetadata: {
                institution: {
                    name: "Plaid Sandbox Investments",
                    institution_id: "ins_109508",
                },
                accounts: [
                    {
                        id: "acc-growth",
                        name: "Plaid Growth Brokerage",
                        mask: "0000",
                        type: "investment",
                        subtype: "brokerage",
                    },
                ],
            },
            fetchImpl: mockPlaidFetch((url, body) => {
                calls.push(url);
                if (url.endsWith("/item/public_token/exchange")) {
                    assert.strictEqual(body.public_token, "public-sandbox-real");
                    return {
                        access_token: "access-sandbox-server-only",
                        item_id: "item-plaid-real",
                        request_id: "request-exchange",
                    };
                }
                if (url.endsWith("/accounts/get")) {
                    assert.strictEqual(body.access_token, "access-sandbox-server-only");
                    return {
                        accounts: [
                            plaidAccount({
                                account_id: "acc-growth",
                                name: "Plaid Growth Brokerage",
                                subtype: "brokerage",
                                current: 125430.42,
                            }),
                            plaidAccount({
                                account_id: "acc-cash",
                                name: "Plaid Cash Management",
                                type: "depository",
                                subtype: "checking",
                                current: 24000,
                            }),
                        ],
                    };
                }
                throw new Error(`Unexpected Plaid URL: ${url}`);
            }),
        });

        assert.deepStrictEqual(calls, [
            `${plaidBaseUrl("sandbox")}/item/public_token/exchange`,
            `${plaidBaseUrl("sandbox")}/accounts/get`,
        ]);
        assert.strictEqual(exchange.itemId, "item-plaid-real");
        assert.strictEqual(exchange.accounts.length, 1);
        assert.strictEqual(exchange.accounts[0].plaidAccountId, "acc-growth");
        assert.strictEqual(exchange.accounts[0].institution.name, "Plaid Sandbox Investments");
        assert.ok(exchange.accounts[0].capabilities.includes("investments"));
        assert.strictEqual(exchange.accessToken, "access-sandbox-server-only");
    });

    test("sanitizes exchange output before returning it to the client", async () => {
        const exchange = await exchangePlaidPublicToken({
            credentials,
            publicToken: "public-sandbox-real",
            fetchImpl: mockPlaidFetch((url) => {
                if (url.endsWith("/item/public_token/exchange")) {
                    return {
                        access_token: "access-sandbox-server-only",
                        item_id: "item-plaid-real",
                        request_id: "request-exchange",
                    };
                }
                return {
                    accounts: [
                        plaidAccount({
                            account_id: "acc-growth",
                            name: "Plaid Growth Brokerage",
                            subtype: "brokerage",
                        }),
                    ],
                };
            }),
        });
        const response = sanitizePlaidExchangeForClient({
            exchange,
            existingPlaidAccountIds: ["acc-growth"],
            accessTokenStored: true,
            accessTokenStorageMode: "encrypted_file",
            accessTokenStorageDurable: true,
        });
        const serialized = JSON.stringify(response);

        assert.strictEqual(response.accessTokenStored, true);
        assert.strictEqual(response.accessTokenStorageMode, "encrypted_file");
        assert.strictEqual(response.accessTokenStorageDurable, true);
        assert.deepStrictEqual(response.duplicatePlaidAccountIds, ["acc-growth"]);
        assert.ok(!serialized.includes("access-sandbox-server-only"));
    });

    test("maps Plaid accounts to connected-account metadata", async () => {
        const exchange = await exchangePlaidPublicToken({
            credentials,
            publicToken: "public-sandbox-real",
            selectedAccountIds: ["acc-growth"],
            linkMetadata: {
                institution: {
                    name: "Plaid Sandbox Investments",
                    institution_id: "ins_109508",
                },
            },
            fetchImpl: mockPlaidFetch((url) => {
                if (url.endsWith("/item/public_token/exchange")) {
                    return {
                        access_token: "access-sandbox-server-only",
                        item_id: "item-plaid-real",
                        request_id: "request-exchange",
                    };
                }
                return {
                    accounts: [
                        plaidAccount({
                            account_id: "acc-growth",
                            name: "Plaid Growth Brokerage",
                            subtype: "brokerage",
                        }),
                    ],
                };
            }),
        });
        const connected = plaidAccountToConnectedAccount({
            account: exchange.accounts[0],
            itemId: exchange.itemId,
            lastSynced: "May 16, 2026",
        });

        assert.strictEqual(connected.provider, "plaid");
        assert.strictEqual(connected.plaidAccountId, "acc-growth");
        assert.strictEqual(connected.plaidItemId, exchange.itemId);
        assert.strictEqual(connected.accountMask, "****0000");
        assert.strictEqual(connected.syncReady, true);
        assert.strictEqual(connected.providerItemStatus, "active");
        assert.ok(connected.capabilities.includes("investments"));
    });

    test("marks Plaid account metadata as reconnect-needed when token storage fails", async () => {
        const exchange = await exchangePlaidPublicToken({
            credentials,
            publicToken: "public-sandbox-real",
            selectedAccountIds: ["acc-growth"],
            linkMetadata: {
                institution: {
                    name: "Plaid Sandbox Investments",
                    institution_id: "ins_109508",
                },
            },
            fetchImpl: mockPlaidFetch((url) => {
                if (url.endsWith("/item/public_token/exchange")) {
                    return {
                        access_token: "access-sandbox-server-only",
                        item_id: "item-plaid-real",
                        request_id: "request-exchange",
                    };
                }
                return {
                    accounts: [
                        plaidAccount({
                            account_id: "acc-growth",
                            name: "Plaid Growth Brokerage",
                            subtype: "brokerage",
                        }),
                    ],
                };
            }),
        });

        const connected = plaidAccountToConnectedAccount({
            account: exchange.accounts[0],
            itemId: exchange.itemId,
            lastSynced: "May 16, 2026",
            tokenStored: false,
            tokenStorageMode: "postgres",
            tokenStorageDurable: false,
        });

        assert.strictEqual(connected.status, "needs-review");
        assert.strictEqual(connected.syncReady, false);
        assert.strictEqual(connected.tokenStorageMode, "postgres");
        assert.strictEqual(connected.providerItemStatus, "missing-token");
    });

    test("matches relinked sandbox accounts by stable non-secret metadata", async () => {
        const exchange = await exchangePlaidPublicToken({
            credentials,
            publicToken: "public-sandbox-real",
            linkMetadata: {
                institution: {
                    name: "First Platypus Bank",
                    institution_id: "ins_109508",
                },
            },
            fetchImpl: mockPlaidFetch((url) => {
                if (url.endsWith("/item/public_token/exchange")) {
                    return {
                        access_token: "access-sandbox-server-only",
                        item_id: "item-plaid-real",
                        request_id: "request-exchange",
                    };
                }
                return {
                    accounts: [
                        plaidAccount({
                            account_id: "new-plaid-account-id",
                            name: "Plaid Checking",
                            type: "depository",
                            subtype: "checking",
                        }),
                    ],
                };
            }),
        });

        const existingAccount = {
            id: "plaid-old-account-id",
            provider: "plaid",
            name: "Plaid Checking",
            type: "Checking · First Platypus Bank",
            accountMask: "****0000",
            holdings: 0,
            accountValue: 110,
            lastSynced: "May 16, 2026",
            status: "reconciled",
            institutionId: "ins_109508",
            institutionName: "First Platypus Bank",
            plaidAccountId: "old-plaid-account-id",
            plaidItemId: "old-item-id",
            capabilities: ["balances"],
        };

        assert.strictEqual(connectedPlaidAccountMatchesDiscovered(existingAccount, exchange.accounts[0]), true);
    });
});

function mockPlaidFetch(handler: (url: string, body: Record<string, unknown>) => unknown): PlaidFetch {
    return async (url, init) => {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        return {
            ok: true,
            status: 200,
            json: async () => handler(url, body),
        };
    };
}

function plaidAccount({
    account_id,
    name,
    type = "investment",
    subtype,
    current = 100000,
}: {
    account_id: string;
    name: string;
    type?: string;
    subtype: string;
    current?: number;
}) {
    return {
        account_id,
        name,
        official_name: `${name} Official`,
        mask: "0000",
        type,
        subtype,
        balances: {
            current,
            iso_currency_code: "USD",
        },
    };
}
