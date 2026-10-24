import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";
import { holdings, portfolios } from "@/db/schema";

import { importHoldings } from "./importHoldings";
import { AccountLimitError, DuplicateAccountNameError, MAX_ACCOUNTS_PER_USER } from "./manage";

const USER = "00000000-0000-4000-8000-00000000a001";
const PORTFOLIO = "0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d";

/**
 * A database that holds AAPL already, and records what it was asked to
 * write. `accounts` are the user's accounts a new one is checked against.
 */
function fakeDatabase(accounts: Array<{ id: string; name: string }> = [{ id: PORTFOLIO, name: "Brokerage" }]) {
    const inserted: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const createdAccounts: Record<string, unknown>[] = [];
    let locks = 0;
    const tx = {
        execute: async () => {
            locks++;
        },
        select: () => ({
            from: (table: unknown) => ({
                where: () => {
                    if (table === portfolios) {
                        return { limit: () => ({ for: async () => [{ id: PORTFOLIO }] }), orderBy: async () => accounts };
                    }
                    return Promise.resolve([{ id: "h-1", symbol: "AAPL", quantity: "1", avgCost: "100" }]);
                },
            }),
        }),
        insert: (table: unknown) => ({
            values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
                if (table === holdings) inserted.push(...(rows as Record<string, unknown>[]));
                return Object.assign(Promise.resolve(), {
                    returning: async () => {
                        createdAccounts.push(rows as Record<string, unknown>);
                        return [{ id: "p-new" }];
                    },
                });
            },
        }),
        update: (table: unknown) => ({
            set: (values: Record<string, unknown>) => ({
                where: async () => {
                    if (table === holdings) updated.push(values);
                },
            }),
        }),
    };
    const database = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as typeof db;
    return { database, inserted, updated, createdAccounts, locks: () => locks };
}

describe("importHoldings", () => {
    const body = {
        portfolioId: PORTFOLIO,
        rows: [
            { symbol: "AAPL", name: "", quantity: 10, avgCost: 150 },
            { symbol: "MSFT", name: "Microsoft", quantity: 4, avgCost: 300 },
            { symbol: "ZZZZ", name: "", quantity: 2, avgCost: 5 },
        ],
    };

    test("regression: imported positions get the stored price, not $0", async () => {
        const { database, inserted, updated } = fakeDatabase();
        const result = await importHoldings(USER, body, { AAPL: 200, MSFT: 410 }, database);
        assert.deepEqual([result.insert, result.update], [2, 1]);

        const msft = inserted.find((row) => row.symbol === "MSFT");
        assert.equal(msft?.currentPrice, 410);
        // AAPL was held: its row is replaced with the new quantity and price.
        assert.equal(updated[0]?.currentPrice, 200);
    });

    test("regression: no market value is stored, so a newer quote values the position", () => {
        // The Codex finding on PR #153: a stored value outranked later
        // quotes on Today, holding the position at its import-day worth.
        const { database, inserted, updated } = fakeDatabase();
        return importHoldings(USER, body, { AAPL: 200, MSFT: 410 }, database).then(() => {
            assert.ok(inserted.every((row) => row.marketValue === null));
            assert.ok(updated.every((row) => row.marketValue === null));
        });
    });

    test("a symbol without a stored price keeps none, for readers to value at cost", async () => {
        const { database, inserted } = fakeDatabase();
        await importHoldings(USER, body, { AAPL: 200, MSFT: 0 }, database);
        for (const symbol of ["MSFT", "ZZZZ"]) {
            const row = inserted.find((r) => r.symbol === symbol);
            assert.equal(row?.currentPrice, null, symbol);
            assert.equal(row?.marketValue, null, symbol);
        }
    });

    test("regression: a held position without a new quote keeps its stored price", async () => {
        // The Codex finding on PR #153: updating AAPL's quantity with no
        // quote for it cleared its price, so it was valued at cost.
        const { database, updated } = fakeDatabase();
        await importHoldings(USER, body, { MSFT: 410 }, database);
        assert.equal(updated.length, 1);
        assert.ok(!("currentPrice" in updated[0]!), "the stored price is left as it is");
        assert.equal(updated[0]?.marketValue, null);
    });
});

describe("importHoldings into a new account", () => {
    const rows = [{ symbol: "MSFT", name: "Microsoft", quantity: 4, avgCost: 300 }];

    test("creates it under the user's account lock", async () => {
        const fake = fakeDatabase();
        const result = await importHoldings(USER, { newPortfolioName: "Joint", rows }, {}, fake.database);
        assert.equal(result.createdPortfolio, true);
        assert.equal(result.portfolioId, "p-new");
        assert.equal(fake.locks(), 1);
        assert.deepEqual(fake.createdAccounts.map((a) => a.name), ["Joint"]);
    });

    test("regression: a name the user already has, in any case, is refused and nothing is written", async () => {
        // Importing twice with the dialog's default name made two accounts
        // the account picker and the Returns switcher couldn't tell apart.
        const fake = fakeDatabase();
        await assert.rejects(
            importHoldings(USER, { newPortfolioName: " brokerage ", rows }, {}, fake.database),
            DuplicateAccountNameError,
        );
        assert.deepEqual([fake.createdAccounts.length, fake.inserted.length], [0, 0]);
    });

    test("past the account limit, no new account", async () => {
        const full = Array.from({ length: MAX_ACCOUNTS_PER_USER }, (_, i) => ({ id: `p${i}`, name: `Account ${i}` }));
        const fake = fakeDatabase(full);
        await assert.rejects(importHoldings(USER, { newPortfolioName: "One more", rows }, {}, fake.database), AccountLimitError);
        assert.deepEqual([fake.createdAccounts.length, fake.inserted.length], [0, 0]);
    });

    test("importing into an existing account doesn't take the lock or check names", async () => {
        const fake = fakeDatabase([]);
        await importHoldings(USER, { portfolioId: PORTFOLIO, rows }, {}, fake.database);
        assert.equal(fake.locks(), 0);
    });
});
