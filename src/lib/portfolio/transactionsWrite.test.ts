import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";
import { portfolios, transactions } from "@/db/schema";
import type { TransactionRow } from "@/lib/validators/transaction";

import { AccountNotFoundError, addTransaction, buildDeleteTransactionQuery, importExternalIds, importTransactions } from "./transactionsWrite";

const USER = "00000000-0000-4000-8000-00000000a001";
const ACCOUNT = "0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d";

const BUY: TransactionRow = { type: "BUY", date: "2026-03-05", symbol: "AAPL", quantity: 10, price: 180.5, fees: 0.02, currency: "USD" };

/** A database where the user owns ACCOUNT (or doesn't), recording inserts. */
function fakeDatabase({ owns = true, duplicates = 0 } = {}) {
    const inserted: Record<string, unknown>[][] = [];
    const tx = {
        select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => (table === portfolios && owns ? [{ id: ACCOUNT }] : []) }) }) }),
        insert: (table: unknown) => ({
            values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
                const list = Array.isArray(rows) ? rows : [rows];
                if (table === transactions) inserted.push(list);
                const ids = list.map((_, i) => ({ id: `t-${i}` }));
                return {
                    returning: async () => ids,
                    onConflictDoNothing: () => ({ returning: async () => ids.slice(duplicates) }),
                };
            },
        }),
    };
    const database = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as typeof db;
    return { database, inserted };
}

describe("addTransaction", () => {
    test("adds it to the user's account, valued and dated", async () => {
        const { database, inserted } = fakeDatabase();
        assert.equal(await addTransaction(USER, ACCOUNT, BUY, database), "t-0");
        assert.deepEqual(inserted[0][0], {
            portfolioId: ACCOUNT, type: "BUY", symbol: "AAPL", quantity: "10", price: "180.5", amount: 1805,
            fees: "0.02", currency: "USD", timestamp: new Date("2026-03-05T12:00:00.000Z"), notes: null,
            source: "manual", externalId: null,
        });
    });

    test("another user's account is not found, and nothing is written", async () => {
        const { database, inserted } = fakeDatabase({ owns: false });
        await assert.rejects(addTransaction(USER, ACCOUNT, BUY, database), AccountNotFoundError);
        assert.deepEqual(inserted, []);
    });
});

describe("importTransactions", () => {
    test("keeps rows under the file's ID, or one made from their contents", () => {
        const ids = importExternalIds([{ ...BUY, externalId: "T-1" }, BUY, BUY, { ...BUY, quantity: 11 }]);
        assert.equal(ids[0], "csv:T-1");
        // Two identical trades in one file both count, under different IDs...
        assert.notEqual(ids[1], ids[2]);
        assert.notEqual(ids[1], ids[3]);
        // ...and the same file gives the same IDs again, so a re-import adds nothing.
        assert.deepEqual(importExternalIds([{ ...BUY, externalId: "T-1" }, BUY, BUY, { ...BUY, quantity: 11 }]), ids);
    });

    test("reports what was new and what the account already had", async () => {
        const { database, inserted } = fakeDatabase({ duplicates: 1 });
        assert.deepEqual(await importTransactions(USER, ACCOUNT, [BUY, { ...BUY, quantity: 5 }], database), { inserted: 1, duplicates: 1 });
        assert.ok(inserted[0].every((row) => row.source === "csv" && typeof row.externalId === "string"));
    });

    test("inserts in batches below Postgres's parameter limit", async () => {
        const { database, inserted } = fakeDatabase();
        const rows = Array.from({ length: 2000 }, (_, i) => ({ ...BUY, quantity: i + 1 }));
        assert.deepEqual(await importTransactions(USER, ACCOUNT, rows, database), { inserted: 2000, duplicates: 0 });
        assert.deepEqual(inserted.map((batch) => batch.length), [1000, 1000]);
    });

    test("another user's account is not found", async () => {
        const { database } = fakeDatabase({ owns: false });
        await assert.rejects(importTransactions(USER, ACCOUNT, [BUY], database), AccountNotFoundError);
    });
});

describe("deleteTransaction", () => {
    test("deletes only a transaction in one of the user's accounts", () => {
        const { sql, params } = buildDeleteTransactionQuery(USER, "t-1").toSQL();
        assert.match(sql, /^delete from "transactions" where \("transactions"\."id" = \$1 and "transactions"\."portfolio_id" in \(select "id" from "portfolios" where "portfolios"\."user_id" = \$2\)\) returning "id"$/i);
        assert.deepEqual(params, ["t-1", USER]);
    });
});
