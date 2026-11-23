import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";

import type { db } from "@/db";
import { RecordLimitError } from "@/lib/limits/records";

import {
    addNetWorthItem,
    buildUserNetWorthItemsQuery,
    deleteNetWorthItem,
    loadNetWorthItems,
    updateNetWorthItem,
} from "./net-worth-items";

const USER = "00000000-0000-4000-8000-00000000a001";
const ITEM = "00000000-0000-4000-8000-000000000701";
const NOW = new Date("2026-11-23T12:00:00.000Z");
const HOME = { kind: "asset", category: "property", name: "Home", value: 300_000, valueAsOf: "2026-11-01", note: "estimate" } as const;

interface Write { op: string; values?: unknown; where?: { sql: string; params: unknown[] } }

/**
 * A database whose selects answer `selects` in order and whose update or
 * delete returns `returned`, recording each write with the condition it
 * was given.
 */
function fakeDatabase(selects: unknown[][] = [], returned: unknown[] = [{ id: ITEM }]) {
    const answers = [...selects];
    const writes: Write[] = [];
    const dialect = new PgDialect();
    const render = (condition: SQL) => dialect.sqlToQuery(condition);
    const chain = (rows: unknown[]) => {
        const result = Object.assign(Promise.resolve(rows), { from: () => result, where: () => result, orderBy: () => result });
        return result;
    };
    const tx = {
        execute: async () => {
            writes.push({ op: "lock" });
        },
        select: () => chain(answers.shift() ?? []),
        insert: (table: PgTable) => ({
            values: (values: unknown) => {
                const write: Write = { op: `insert ${getTableName(table)}`, values };
                writes.push(write);
                return {
                    returning: async () => [{ id: "n-new" }],
                    onConflictDoUpdate: async () => {
                        write.op = `upsert ${getTableName(table)}`;
                    },
                };
            },
        }),
        update: (table: PgTable) => ({
            set: (values: unknown) => ({
                where: (condition: SQL) => ({
                    returning: async () => {
                        writes.push({ op: `update ${getTableName(table)}`, values, where: render(condition) });
                        return returned;
                    },
                }),
            }),
        }),
        delete: (table: PgTable) => ({
            where: (condition: SQL) => {
                writes.push({ op: `delete ${getTableName(table)}`, where: render(condition) });
                return Object.assign(Promise.resolve(undefined), { returning: async () => returned });
            },
        }),
    };
    const database = Object.assign(tx, { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) }) as unknown as typeof db;
    return { database, writes };
}

describe("reading other assets and debts", () => {
    test("only the user's, assets first, then the largest value first", () => {
        const { sql, params } = buildUserNetWorthItemsQuery(USER).toSQL();
        assert.match(sql, /from "net_worth_items" where "net_worth_items"\."user_id" = \$1 order by "net_worth_items"\."kind" asc, "net_worth_items"\."value" desc, "net_worth_items"\."name" asc, "net_worth_items"\."id" asc$/);
        assert.deepEqual(params, [USER]);
    });

    test("values come back as numbers, and the last save as an ISO time", async () => {
        const { database } = fakeDatabase([[
            { id: ITEM, kind: "asset", category: "property", name: "Home", value: "1234.56", valueAsOf: "2026-11-01", note: null, updatedAt: NOW },
        ]]);
        assert.deepEqual(await loadNetWorthItems(USER, database), [
            { id: ITEM, kind: "asset", category: "property", name: "Home", value: 1234.56, valueAsOf: "2026-11-01", note: null, updatedAt: "2026-11-23T12:00:00.000Z" },
        ]);
    });
});

describe("writing other assets and debts", () => {
    test("adding one counts it under the user's lock, then keeps its value as of its day", async () => {
        const { database, writes } = fakeDatabase([[{ n: 3 }], [{ n: 4 }]]);
        assert.equal(await addNetWorthItem(USER, HOME, { database, now: NOW }), "n-new");
        assert.deepEqual(writes.map((w) => w.op), ["lock", "insert net_worth_items", "delete net_worth_item_values", "upsert net_worth_item_values"]);
        assert.deepEqual(writes[1].values, {
            userId: USER, kind: "asset", category: "property", name: "Home", value: "300000", valueAsOf: "2026-11-01", note: "estimate",
            createdAt: NOW, updatedAt: NOW,
        });
        // It stands from its day on: anything kept for a later day goes.
        assert.equal(writes[2].where?.sql, '("net_worth_item_values"."net_worth_item_id" = $1 and "net_worth_item_values"."date" > $2)');
        assert.deepEqual(writes[2].where?.params, ["n-new", "2026-11-01"]);
        assert.deepEqual(writes[3].values, { netWorthItemId: "n-new", date: "2026-11-01", value: "300000", recordedAt: NOW });
    });

    test("adding one past the limit is refused", async () => {
        const { database } = fakeDatabase([[{ n: 100 }], [{ n: 101 }]]);
        await assert.rejects(addNetWorthItem(USER, HOME, { database, now: NOW }), RecordLimitError);
    });

    test("an edit saves every field and keeps the new value as of its day, matching the item and the user", async () => {
        const { database, writes } = fakeDatabase();
        const mortgage = { kind: "debt", category: "mortgage", name: "Mortgage", value: 199_500.5, valueAsOf: "2026-11-15", note: null } as const;
        assert.equal(await updateNetWorthItem(USER, ITEM, mortgage, { database, now: NOW }), true);
        // No lock: an edit adds nothing, so the limit never refuses it.
        assert.deepEqual(writes.map((w) => w.op), ["update net_worth_items", "delete net_worth_item_values", "upsert net_worth_item_values"]);
        assert.deepEqual(writes[0].values, {
            kind: "debt", category: "mortgage", name: "Mortgage", value: "199500.5", valueAsOf: "2026-11-15", note: null, updatedAt: NOW,
        });
        assert.equal(writes[0].where?.sql, '("net_worth_items"."id" = $1 and "net_worth_items"."user_id" = $2)');
        assert.deepEqual(writes[0].where?.params, [ITEM, USER]);
        assert.deepEqual(writes[2].values, { netWorthItemId: ITEM, date: "2026-11-15", value: "199500.5", recordedAt: NOW });
    });

    test("editing or deleting an item the user doesn't have (another user's, or one already gone) is false, and keeps no value", async () => {
        const edit = fakeDatabase([], []);
        assert.equal(await updateNetWorthItem(USER, ITEM, HOME, { database: edit.database, now: NOW }), false);
        assert.deepEqual(edit.writes.map((w) => w.op), ["update net_worth_items"]);

        const removal = fakeDatabase([], []);
        assert.equal(await deleteNetWorthItem(USER, ITEM, { database: removal.database }), false);
        assert.equal(removal.writes[0].where?.sql, '("net_worth_items"."id" = $1 and "net_worth_items"."user_id" = $2)');
        assert.deepEqual(removal.writes[0].where?.params, [ITEM, USER]);
    });

    test("deleting one of the user's is true; its values go with it", async () => {
        const { database, writes } = fakeDatabase();
        assert.equal(await deleteNetWorthItem(USER, ITEM, { database }), true);
        // The values cascade from the item (migration 0040): one statement.
        assert.deepEqual(writes.map((w) => w.op), ["delete net_worth_items"]);
    });
});
