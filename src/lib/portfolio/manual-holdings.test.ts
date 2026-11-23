import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { db } from "@/db";
import { RecordLimitError } from "@/lib/limits/records";

import {
    addManualHolding,
    buildUserManualHoldingsQuery,
    deleteManualHolding,
    importManualRows,
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
 * was asked to write. Every select's `where` is kept, as SQL, for the
 * ownership checks. The user's account lock is "lock"; the records lock
 * of holdings valued by hand, "records lock".
 */
function fakeDatabase(selects: unknown[][]) {
    const answers = [...selects];
    const writes: Array<{ op: string; values?: unknown }> = [];
    const wheres: { sql: string; params: unknown[] }[] = [];
    const dialect = new PgDialect();
    const chain = (rows: unknown[]) => {
        const result = Object.assign(Promise.resolve(rows), {
            from: () => result,
            where: (condition: SQL) => {
                wheres.push(dialect.sqlToQuery(condition));
                return result;
            },
            orderBy: () => result,
            limit: () => result,
        });
        return result;
    };
    const tx = {
        execute: async (query: SQL) => {
            const key = String(dialect.sqlToQuery(query).params[0]);
            writes.push({ op: key.startsWith("atlas:records:manualHoldings:") ? "records lock" : "lock" });
        },
        select: () => chain(answers.shift() ?? []),
        insert: () => ({
            values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
                writes.push({ op: "insert", values });
                return {
                    // New ids, in the order the rows were given, with each one's key.
                    returning: async () => (Array.isArray(values) ? values : [values])
                        .map((row, i) => ({ id: i === 0 ? "m-new" : `m-new-${i + 1}`, externalId: row.externalId })),
                    onConflictDoUpdate: async () => {
                        writes[writes.length - 1].op = "record value";
                    },
                };
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
                // Awaited as is: the later values dropped.
                then: (resolve: (value: unknown) => void) => {
                    writes.push({ op: "drop later values" });
                    resolve(undefined);
                },
                returning: async () => {
                    writes.push({ op: "delete" });
                    return answers.shift() ?? [];
                },
            }),
        }),
    };
    const database = Object.assign(tx, { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) }) as unknown as typeof db;
    return { database, writes, wheres };
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
            { id: "m-1", portfolioId: ACCOUNT, name: "Fund", identifier: null, quantity: "10.5", value: "1050.25", costBasis: null, valueAsOf: "2026-11-19", source: "manual", externalId: null },
            { id: "m-2", portfolioId: ACCOUNT, name: "Private", identifier: null, quantity: null, value: "200", costBasis: "0", valueAsOf: "2026-11-18", source: "plaid", externalId: `${ACCOUNT}:sec_1` },
        ]]);
        const rows = await loadManualHoldings(USER, database);
        assert.deepEqual(rows.map((r) => [r.quantity, r.value, r.costBasis]), [[10.5, 1050.25, null], [null, 200, 0]]);
    });

    test("an import key only from a positions file, never a linked account's; and which holdings an import may update", async () => {
        const { database } = fakeDatabase([[
            { id: "m-1", portfolioId: ACCOUNT, name: "Added", identifier: null, quantity: null, value: "1", costBasis: null, valueAsOf: "2026-11-19", source: "manual", externalId: null },
            { id: "m-2", portfolioId: ACCOUNT, name: "Imported", identifier: null, quantity: null, value: "1", costBasis: null, valueAsOf: "2026-11-19", source: "csv", externalId: "csv:name:imported" },
            { id: "m-3", portfolioId: ACCOUNT, name: "Synced", identifier: null, quantity: null, value: "1", costBasis: null, valueAsOf: "2026-11-19", source: "plaid", externalId: `${ACCOUNT}:sec_1` },
            { id: "m-4", portfolioId: ACCOUNT, name: "Synced, then edited", identifier: null, quantity: null, value: "1", costBasis: null, valueAsOf: "2026-11-19", source: "manual", externalId: `${ACCOUNT}:sec_2` },
            { id: "m-5", portfolioId: ACCOUNT, name: "Moved from another linked account", identifier: null, quantity: null, value: "1", costBasis: null, valueAsOf: "2026-11-19", source: "manual", externalId: `${OTHER_ACCOUNT}:sec_3` },
        ]]);
        const rows = await loadManualHoldings(USER, database);
        // Its own account's syncs' holdings are a file's to update once it
        // no longer syncs (the page leaves out an account that still does);
        // another account's key keeps that account's sync from adding it again.
        assert.deepEqual(rows.map((r) => [r.id, r.importKey, r.importable]), [
            ["m-1", null, true],
            ["m-2", "csv:name:imported", true],
            ["m-3", null, true],
            ["m-4", null, true],
            ["m-5", null, false],
        ]);
        for (const r of rows) assert.equal("externalId" in r, false, r.id);
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
        const { database, writes } = fakeDatabase([[{ id: ACCOUNT }], [{ n: 0 }], [{ n: 1 }]]);
        assert.equal(await addManualHolding(USER, ACCOUNT, INPUT, { database, now }), "m-new");
        // Under the account-write lock a Plaid sync takes, so neither
        // overwrites the other (the Codex finding on PR #216), and then the
        // lock its limit is counted under.
        assert.deepEqual(writes.map((w) => w.op), ["lock", "records lock", "insert", "drop later values", "record value", "update"]);
        assert.deepEqual(writes[2].values, {
            userId: USER, portfolioId: ACCOUNT, name: INPUT.name, identifier: INPUT.identifier, quantity: "10", value: "1500", costBasis: null,
            valueAsOf: INPUT.valueAsOf, source: "manual", createdAt: now, updatedAt: now,
        });
        // Its value as of its day, the user's from then on.
        assert.deepEqual(writes[4].values, { manualHoldingId: "m-new", date: INPUT.valueAsOf, value: "1500", quantity: "10", recordedAt: now });
        assert.deepEqual(writes[5].values, { updatedAt: now });
    });

    test("past the limit of holdings valued by hand, adding one is refused and goes no further", async () => {
        const { database, writes } = fakeDatabase([[{ id: ACCOUNT }], [{ n: 1_000 }], [{ n: 1_001 }]]);
        await assert.rejects(addManualHolding(USER, ACCOUNT, INPUT, { database }), RecordLimitError);
        // The error rolls the transaction, and the insert with it, back.
        assert.deepEqual(writes.map((w) => w.op), ["lock", "records lock", "insert"]);
    });

    test("editing a holding the user doesn't have is false, and nothing is written", async () => {
        const { database, writes } = fakeDatabase([[{ id: ACCOUNT }], []]);
        assert.equal(await updateManualHolding(USER, "m-missing", ACCOUNT, INPUT, { database }), false);
        assert.deepEqual(writes, [{ op: "lock" }]);
    });

    test("moving a holding to another account marks both accounts changed", async () => {
        const { database, writes } = fakeDatabase([[{ id: OTHER_ACCOUNT }], [{ portfolioId: ACCOUNT, source: "manual", externalId: null }]]);
        assert.equal(await updateManualHolding(USER, "m-1", OTHER_ACCOUNT, INPUT, { database }), true);
        assert.deepEqual(writes.map((w) => w.op), ["lock", "update", "drop later values", "record value", "update", "update"]);
        assert.equal((writes[1].values as { source: string }).source, "manual");
    });

    test("an edit keeps a CSV holding's source and key, and still makes a linked account's holding the user's", async () => {
        const csv = fakeDatabase([[{ id: ACCOUNT }], [{ portfolioId: ACCOUNT, source: "csv", externalId: "csv:id:123456789" }]]);
        assert.equal(await updateManualHolding(USER, "m-1", ACCOUNT, INPUT, { database: csv.database }), true);
        assert.equal((csv.writes[1].values as { source: string }).source, "csv");
        assert.equal("externalId" in (csv.writes[1].values as object), false);

        const plaid = fakeDatabase([[{ id: ACCOUNT }], [{ portfolioId: ACCOUNT, source: "plaid", externalId: `${ACCOUNT}:sec_1` }]]);
        assert.equal(await updateManualHolding(USER, "m-2", ACCOUNT, INPUT, { database: plaid.database }), true);
        assert.equal((plaid.writes[1].values as { source: string }).source, "manual");
        assert.equal("externalId" in (plaid.writes[1].values as object), false);
    });

    test("regression: moved into an account that has a holding with its key, a holding goes without the key rather than failing", async () => {
        // The key is unique within an account: the move used to break that
        // index and answer 500.
        const clash = fakeDatabase([[{ id: OTHER_ACCOUNT }], [{ portfolioId: ACCOUNT, source: "csv", externalId: "csv:id:123456789" }], [{ id: "m-9" }]]);
        assert.equal(await updateManualHolding(USER, "m-1", OTHER_ACCOUNT, INPUT, { database: clash.database }), true);
        assert.deepEqual(clash.wheres[2].params, [OTHER_ACCOUNT, USER, "csv:id:123456789"]);
        assert.deepEqual([(clash.writes[1].values as { externalId: unknown }).externalId, (clash.writes[1].values as { source: string }).source], [null, "csv"]);

        const free = fakeDatabase([[{ id: OTHER_ACCOUNT }], [{ portfolioId: ACCOUNT, source: "csv", externalId: "csv:id:123456789" }], []]);
        assert.equal(await updateManualHolding(USER, "m-1", OTHER_ACCOUNT, INPUT, { database: free.database }), true);
        // Kept: the next file into its new account still finds it.
        assert.equal("externalId" in (free.writes[1].values as object), false);
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

describe("importManualRows", () => {
    const now = new Date("2026-11-20T15:00:00.000Z");
    const trust = { name: "Target 2055 Trust", identifier: null, quantity: 250.5, value: 12345.67, costBasis: null };
    const saved = (over: Record<string, unknown> = {}) => ({
        id: "m-1", name: "Target 2055 Trust", identifier: null, externalId: null,
        quantity: "200", value: "10000", costBasis: "9000", valueAsOf: "2026-11-01", ...over,
    });

    test("a new holding: source csv, its import key and the file's day, and that day's value, keeping later days", async () => {
        const { database, writes } = fakeDatabase([[]]);
        const result = await importManualRows(database, USER, ACCOUNT, [trust], { asOf: "2026-11-02", positions: [], now });
        assert.deepEqual(result, { insert: 1, update: 0, unchanged: 0, replacedPositions: 0, replace: [], changed: true });
        assert.deepEqual(writes.map((w) => w.op), ["insert", "record value"]);
        assert.deepEqual(writes[0].values, [{
            userId: USER, portfolioId: ACCOUNT, name: "Target 2055 Trust", identifier: null, quantity: "250.5", value: "12345.67", costBasis: null,
            valueAsOf: "2026-11-02", source: "csv", externalId: "csv:name:target 2055 trust", createdAt: now, updatedAt: now,
        }]);
        assert.deepEqual(writes[1].values, [{ manualHoldingId: "m-new", date: "2026-11-02", value: "12345.67", quantity: "250.5", recordedAt: now }]);
    });

    test("only the account's holdings added by hand, by a file or by its own syncs are read, never one another account's sync keys", async () => {
        const { database, wheres } = fakeDatabase([[]]);
        await importManualRows(database, USER, ACCOUNT, [trust], { asOf: "2026-11-02", positions: [], now });
        assert.equal(wheres[0].sql, '("manual_holdings"."portfolio_id" = $1 and "manual_holdings"."user_id" = $2 and ("manual_holdings"."external_id" is null or "manual_holdings"."external_id" like $3 or "manual_holdings"."external_id" like $4))');
        assert.deepEqual(wheres[0].params, [ACCOUNT, USER, "csv:%", `${ACCOUNT}:%`]);
    });

    test("regression: a holding the account's last sync brought in is found by its name or identifier, and becomes the file's", async () => {
        // A linked account that no longer syncs: its sync's key isn't a
        // file's key, so the row finds the holding the way it finds one
        // added by hand, and keys it as from the file from then on.
        const synced = saved({ id: "m-7", identifier: "99ZZ12341", externalId: `${ACCOUNT}:sec_trust` });
        const byIdentifier = fakeDatabase([[synced]]);
        const result = await importManualRows(byIdentifier.database, USER, ACCOUNT, [{ ...trust, name: "Target 2055 Trust Fund", identifier: "99ZZ12341" }], { asOf: "2026-11-02", positions: [], now });
        assert.deepEqual([result.insert, result.update], [0, 1]);
        assert.deepEqual(byIdentifier.writes.map((w) => w.op), ["update", "record value"]);
        assert.deepEqual(byIdentifier.writes[0].values, {
            externalId: "csv:id:99ZZ12341", source: "csv", identifier: "99ZZ12341", updatedAt: now,
            value: "12345.67", quantity: "250.5", costBasis: "9000", valueAsOf: "2026-11-02",
        });
        const byName = fakeDatabase([[saved({ id: "m-8", externalId: `${ACCOUNT}:sec_trust` })]]);
        await importManualRows(byName.database, USER, ACCOUNT, [trust], { asOf: "2026-11-02", positions: [], now });
        assert.deepEqual(
            [byName.writes[0].op, (byName.writes[0].values as Record<string, unknown>).externalId, (byName.writes[1].values as Record<string, unknown>[])[0].manualHoldingId],
            ["update", "csv:name:target 2055 trust", "m-8"],
        );
    });

    test("an update takes the file's value, units and day, keeps the saved cost, name and identifier, and is keyed as from the file", async () => {
        const { database, writes } = fakeDatabase([[saved()]]);
        const result = await importManualRows(database, USER, ACCOUNT, [{ ...trust, name: "TARGET 2055 TRUST", identifier: "99ZZ12341" }], { asOf: "2026-11-02", positions: [], now });
        assert.deepEqual(result, { insert: 0, update: 1, unchanged: 0, replacedPositions: 0, replace: [], changed: true });
        assert.deepEqual(writes.map((w) => w.op), ["update", "record value"]);
        assert.deepEqual(writes[0].values, {
            externalId: "csv:id:99ZZ12341", source: "csv", identifier: "99ZZ12341", updatedAt: now,
            value: "12345.67", quantity: "250.5", costBasis: "9000", valueAsOf: "2026-11-02",
        });
        assert.deepEqual(writes[1].values, [{ manualHoldingId: "m-1", date: "2026-11-02", value: "12345.67", quantity: "250.5", recordedAt: now }]);
        // A saved identifier stays; the file's cost replaces the saved one.
        const kept = fakeDatabase([[saved({ identifier: "XYZ123" })]]);
        await importManualRows(kept.database, USER, ACCOUNT, [{ ...trust, costBasis: 9500 }], { asOf: "2026-11-02", positions: [], now });
        assert.deepEqual([(kept.writes[0].values as Record<string, unknown>).identifier, (kept.writes[0].values as Record<string, unknown>).costBasis], ["XYZ123", "9500"]);
    });

    test("a file older than the saved value only records its own day", async () => {
        const { database, writes } = fakeDatabase([[saved({ externalId: "csv:name:target 2055 trust" })]]);
        const result = await importManualRows(database, USER, ACCOUNT, [trust], { asOf: "2026-10-15", positions: [], now });
        assert.deepEqual(result, { insert: 0, update: 0, unchanged: 1, replacedPositions: 0, replace: [], changed: false });
        assert.deepEqual(writes[0].values, { externalId: "csv:name:target 2055 trust", source: "csv", identifier: null, updatedAt: now });
        assert.deepEqual(writes[1].values, [{ manualHoldingId: "m-1", date: "2026-10-15", value: "12345.67", quantity: "250.5", recordedAt: now }]);
        assert.ok(!writes.some((w) => w.op === "drop later values"));
    });

    test("a position held under the row's code is listed to replace; a new value alone leaves the account unchanged", async () => {
        const replacing = fakeDatabase([[]]);
        const result = await importManualRows(replacing.database, USER, ACCOUNT, [{ ...trust, identifier: "99ZZ12341" }], { asOf: "2026-11-02", positions: ["AAPL", "99ZZ12341"], now });
        assert.deepEqual([result.replace, result.replacedPositions], [["99ZZ12341"], 1]);

        const price = fakeDatabase([[saved({ quantity: "250.5", costBasis: null })]]);
        assert.equal((await importManualRows(price.database, USER, ACCOUNT, [trust], { asOf: "2026-11-02", positions: [], now })).changed, false);
    });
});
