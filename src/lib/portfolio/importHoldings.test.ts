import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";
import { holdings, portfolios } from "@/db/schema";

import { importHoldings } from "./importHoldings";

const USER = "00000000-0000-4000-8000-00000000a001";
const PORTFOLIO = "0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d";

/** A database that holds AAPL already, and records what it was asked to write. */
function fakeDatabase() {
    const inserted: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const tx = {
        select: () => ({
            from: (table: unknown) => ({
                where: () => {
                    if (table === portfolios) return { limit: () => ({ for: async () => [{ id: PORTFOLIO }] }) };
                    return Promise.resolve([{ id: "h-1", symbol: "AAPL", quantity: "1", avgCost: "100" }]);
                },
            }),
        }),
        insert: (table: unknown) => ({
            values: async (rows: Record<string, unknown>[]) => {
                if (table === holdings) inserted.push(...rows);
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
    return { database, inserted, updated };
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

    test("regression: imported positions are valued at the stored price, not $0", async () => {
        const { database, inserted, updated } = fakeDatabase();
        const result = await importHoldings(USER, body, { AAPL: 200, MSFT: 410 }, database);
        assert.deepEqual([result.insert, result.update], [2, 1]);

        const msft = inserted.find((row) => row.symbol === "MSFT");
        assert.equal(msft?.currentPrice, 410);
        assert.equal(msft?.marketValue, 1640);
        // AAPL was held: its row is replaced and valued at the new quantity.
        assert.equal(updated[0]?.currentPrice, 200);
        assert.equal(updated[0]?.marketValue, 2000);
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
});
