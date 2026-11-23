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
    NetWorthKindChangeError,
    readNetWorthItemsForPage,
    updateNetWorthItem,
} from "./net-worth-items";

const USER = "00000000-0000-4000-8000-00000000a001";
const ITEM = "00000000-0000-4000-8000-000000000701";
const NOW = new Date("2026-11-23T12:00:00.000Z");
const HOME = { kind: "asset", category: "property", name: "Home", value: 300_000, valueAsOf: "2026-11-01", note: "estimate" } as const;
const MORTGAGE = { kind: "debt", category: "mortgage", name: "Mortgage", value: 199_500.5, valueAsOf: "2026-11-15", note: null } as const;

interface Write { op: string; values?: unknown; where?: { sql: string; params: unknown[] } }
interface Read { where?: { sql: string; params: unknown[] }; lock?: string }

/**
 * A database whose selects answer `selects` in order and whose update or
 * delete returns `returned`, recording each write with the condition it
 * was given, and each read's condition and lock.
 */
function fakeDatabase(selects: unknown[][] = [], returned: unknown[] = [{ id: ITEM }]) {
    const answers = [...selects];
    const writes: Write[] = [];
    const reads: Read[] = [];
    const dialect = new PgDialect();
    const render = (condition: SQL) => dialect.sqlToQuery(condition);
    const chain = (rows: unknown[]) => {
        const read: Read = {};
        reads.push(read);
        const result = Object.assign(Promise.resolve(rows), {
            from: () => result,
            where: (condition: SQL) => {
                read.where = render(condition);
                return result;
            },
            orderBy: () => result,
            for: (strength: string) => {
                read.lock = strength;
                return result;
            },
        });
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
                where: (condition: SQL) => {
                    writes.push({ op: `update ${getTableName(table)}`, values, where: render(condition) });
                    return Object.assign(Promise.resolve(undefined), { returning: async () => returned });
                },
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
    return { database, writes, reads };
}

/** Counts console.warn's calls, silencing them, until restored. */
function silenceWarnings() {
    const original = console.warn;
    const calls: unknown[][] = [];
    console.warn = (...args: unknown[]) => calls.push(args);
    return { calls, restore: () => { console.warn = original; } };
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

describe("reading them for a page", () => {
    const ROW = { id: ITEM, ...HOME, updatedAt: NOW.toISOString() };

    test("asks for the user's own, and passes them on", async () => {
        const asked: string[] = [];
        const read = await readNetWorthItemsForPage(USER, async (userId) => {
            asked.push(userId);
            return [ROW];
        }, { page: "Accounts", databaseConfigured: true });
        assert.deepEqual(read, [ROW]);
        assert.deepEqual(asked, [USER]);
    });

    test("a database that fails to answer is unavailable, never no items, and is logged with the page", async () => {
        const warnings = silenceWarnings();
        try {
            const read = await readNetWorthItemsForPage(USER, async () => {
                throw new Error("connection refused");
            }, { page: "Today", databaseConfigured: true });
            assert.equal(read, "unavailable");
            assert.equal(warnings.calls.length, 1);
            assert.match(String(warnings.calls[0][0]), /^Today: other assets and debts fetch failed/);
        } finally {
            warnings.restore();
        }
    });

    test("without a database, none are asked for: there's nowhere to keep them", async () => {
        let asked = false;
        const read = await readNetWorthItemsForPage(USER, async () => {
            asked = true;
            return [ROW];
        }, { page: "Accounts", databaseConfigured: false });
        assert.equal(read, null);
        assert.equal(asked, false);
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
        const { database, writes, reads } = fakeDatabase([[{ kind: "debt" }]]);
        assert.equal(await updateNetWorthItem(USER, ITEM, MORTGAGE, { database, now: NOW }), true);
        // The user's item, locked until the save is done.
        assert.equal(reads[0].where?.sql, '("net_worth_items"."id" = $1 and "net_worth_items"."user_id" = $2)');
        assert.deepEqual(reads[0].where?.params, [ITEM, USER]);
        assert.equal(reads[0].lock, "update");
        // No records lock: an edit adds nothing, so the limit never refuses it.
        assert.deepEqual(writes.map((w) => w.op), ["update net_worth_items", "delete net_worth_item_values", "upsert net_worth_item_values"]);
        assert.deepEqual(writes[0].values, {
            kind: "debt", category: "mortgage", name: "Mortgage", value: "199500.5", valueAsOf: "2026-11-15", note: null, updatedAt: NOW,
        });
        assert.equal(writes[0].where?.sql, '("net_worth_items"."id" = $1 and "net_worth_items"."user_id" = $2)');
        assert.deepEqual(writes[0].where?.params, [ITEM, USER]);
        assert.deepEqual(writes[2].values, { netWorthItemId: ITEM, date: "2026-11-15", value: "199500.5", recordedAt: NOW });
    });

    test("an edit that would make an asset a debt, or a debt an asset, is refused and saves nothing", async () => {
        const asset = fakeDatabase([[{ kind: "asset" }]]);
        await assert.rejects(updateNetWorthItem(USER, ITEM, MORTGAGE, { database: asset.database, now: NOW }), (error: unknown) => {
            assert.ok(error instanceof NetWorthKindChangeError);
            assert.equal(error.message, "An asset can't become a debt. Delete it and add it as a debt.");
            return true;
        });
        assert.deepEqual(asset.writes, []);

        const debt = fakeDatabase([[{ kind: "debt" }]]);
        await assert.rejects(updateNetWorthItem(USER, ITEM, HOME, { database: debt.database, now: NOW }), {
            message: "A debt can't become an asset. Delete it and add it as an asset.",
        });
        assert.deepEqual(debt.writes, []);
    });

    test("editing or deleting an item the user doesn't have (another user's, or one already gone) is false, and keeps no value", async () => {
        // Whatever kind is sent: another user's item doesn't give its kind away.
        const edit = fakeDatabase([[]], []);
        assert.equal(await updateNetWorthItem(USER, ITEM, MORTGAGE, { database: edit.database, now: NOW }), false);
        assert.deepEqual(edit.writes, []);

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
