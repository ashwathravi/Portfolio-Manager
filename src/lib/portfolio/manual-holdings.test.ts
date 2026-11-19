import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";

import {
    addManualHolding,
    buildUserManualHoldingsQuery,
    deleteManualHolding,
    loadManualHoldings,
    manualTotalsByPortfolio,
    updateManualHolding,
} from "./manual-holdings";
import { AccountNotFoundError } from "./transactionsWrite";

const USER = "00000000-0000-4000-8000-00000000a001";
const ACCOUNT = "0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d";
const OTHER_ACCOUNT = "1c8e4d2f-7b4d-4d8f-8a4b-3e5f9b2c3d4e";
const INPUT = { name: "Stable Value Fund", identifier: "123456789", quantity: 10, value: 1500, costBasis: null, valueAsOf: "2026-11-19" };

/**
 * A database whose selects answer `selects` in order, recording what it
 * was asked to write. Every `where` is kept for the ownership checks.
 */
function fakeDatabase(selects: unknown[][]) {
    const answers = [...selects];
    const writes: Array<{ op: string; values?: unknown }> = [];
    const chain = (rows: unknown[]) => {
        const result = Object.assign(Promise.resolve(rows), {
            from: () => result,
            where: () => result,
            orderBy: () => result,
            limit: () => result,
        });
        return result;
    };
    const tx = {
        execute: async () => {
            writes.push({ op: "lock" });
        },
        select: () => chain(answers.shift() ?? []),
        insert: () => ({
            values: (values: unknown) => {
                writes.push({ op: "insert", values });
                return { returning: async () => [{ id: "m-new" }] };
            },
        }),
        update: () => ({
            set: (values: unknown) => ({
                where: async () => {
                    writes.push({ op: "update", values });
                },
            }),
        }),
        delete: () => ({
            where: () => ({
                returning: async () => {
                    writes.push({ op: "delete" });
                    return answers.shift() ?? [];
                },
            }),
        }),
    };
    const database = Object.assign(tx, { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) }) as unknown as typeof db;
    return { database, writes };
}

describe("manualTotalsByPortfolio", () => {
    test("adds up each account's holdings separately", () => {
        const totals = manualTotalsByPortfolio([
            { portfolioId: ACCOUNT, value: 100, costBasis: 80 },
            { portfolioId: OTHER_ACCOUNT, value: 50, costBasis: 60 },
            { portfolioId: ACCOUNT, value: 25.5, costBasis: 20 },
        ]);
        assert.deepEqual(Object.fromEntries(totals), {
            [ACCOUNT]: { value: 125.5, cost: 100 },
            [OTHER_ACCOUNT]: { value: 50, cost: 60 },
        });
    });

    test("an unknown cost counts as the value (no gain claimed); a cost of zero is zero", () => {
        const totals = manualTotalsByPortfolio([
            { portfolioId: ACCOUNT, value: 100, costBasis: null },
            { portfolioId: OTHER_ACCOUNT, value: 100, costBasis: 0 },
        ]);
        assert.deepEqual(totals.get(ACCOUNT), { value: 100, cost: 100 });
        assert.deepEqual(totals.get(OTHER_ACCOUNT), { value: 100, cost: 0 });
    });

    test("no holdings, no accounts", () => {
        assert.equal(manualTotalsByPortfolio([]).size, 0);
    });
});

describe("loadManualHoldings", () => {
    test("reads only the user's holdings", () => {
        const { sql, params } = buildUserManualHoldingsQuery(USER).toSQL();
        assert.match(sql, /where "manual_holdings"\."user_id" = \$1/);
        assert.deepEqual(params, [USER]);
    });

    test("numbers come back as numbers; a missing quantity or cost stays unknown", async () => {
        const { database } = fakeDatabase([[
            { id: "m-1", portfolioId: ACCOUNT, name: "Fund", identifier: null, quantity: "10.5", value: "1050.25", costBasis: null, valueAsOf: "2026-11-19", source: "manual" },
            { id: "m-2", portfolioId: ACCOUNT, name: "Private", identifier: null, quantity: null, value: "200", costBasis: "0", valueAsOf: "2026-11-18", source: "plaid" },
        ]]);
        const rows = await loadManualHoldings(USER, database);
        assert.deepEqual(rows.map((r) => [r.quantity, r.value, r.costBasis]), [[10.5, 1050.25, null], [null, 200, 0]]);
    });
});

describe("writing holdings valued by hand", () => {
    test("adding into another user's account is not found, and nothing is written", async () => {
        const { database, writes } = fakeDatabase([[]]);
        await assert.rejects(addManualHolding(USER, OTHER_ACCOUNT, INPUT, { database }), AccountNotFoundError);
        assert.deepEqual(writes, [{ op: "lock" }]);
    });

    test("adding into the user's account saves it as theirs and marks the account changed", async () => {
        const now = new Date("2026-11-19T12:00:00.000Z");
        const { database, writes } = fakeDatabase([[{ id: ACCOUNT }]]);
        assert.equal(await addManualHolding(USER, ACCOUNT, INPUT, { database, now }), "m-new");
        // Under the account-write lock a Plaid sync takes, so neither
        // overwrites the other (the Codex finding on PR #216).
        assert.deepEqual(writes.map((w) => w.op), ["lock", "insert", "update"]);
        assert.deepEqual(writes[1].values, {
            userId: USER, portfolioId: ACCOUNT, name: INPUT.name, identifier: INPUT.identifier, quantity: "10", value: "1500", costBasis: null,
            valueAsOf: INPUT.valueAsOf, source: "manual", createdAt: now, updatedAt: now,
        });
        assert.deepEqual(writes[2].values, { updatedAt: now });
    });

    test("editing a holding the user doesn't have is false, and nothing is written", async () => {
        const { database, writes } = fakeDatabase([[{ id: ACCOUNT }], []]);
        assert.equal(await updateManualHolding(USER, "m-missing", ACCOUNT, INPUT, { database }), false);
        assert.deepEqual(writes, [{ op: "lock" }]);
    });

    test("moving a holding to another account marks both accounts changed", async () => {
        const { database, writes } = fakeDatabase([[{ id: OTHER_ACCOUNT }], [{ portfolioId: ACCOUNT }]]);
        assert.equal(await updateManualHolding(USER, "m-1", OTHER_ACCOUNT, INPUT, { database }), true);
        assert.deepEqual(writes.map((w) => w.op), ["lock", "update", "update", "update"]);
        assert.equal((writes[1].values as { source: string }).source, "manual");
    });

    test("deleting one the user doesn't have is false; deleting theirs marks its account changed", async () => {
        const missing = fakeDatabase([[]]);
        assert.equal(await deleteManualHolding(USER, "m-missing", { database: missing.database }), false);
        assert.deepEqual(missing.writes.map((w) => w.op), ["lock", "delete"]);

        const held = fakeDatabase([[{ portfolioId: ACCOUNT }]]);
        assert.equal(await deleteManualHolding(USER, "m-1", { database: held.database }), true);
        assert.deepEqual(held.writes.map((w) => w.op), ["lock", "delete", "update"]);
    });
});
