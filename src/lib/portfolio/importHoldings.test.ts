import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { db } from "@/db";
import { holdings, manualHoldingValues, manualHoldings, portfolios } from "@/db/schema";
import { RecordLimitError } from "@/lib/limits/records";

import { importHoldings, importHoldingsToAccounts, LinkedAccountImportError } from "./importHoldings";
import { AccountLimitError, DuplicateAccountNameError, MAX_ACCOUNTS_PER_USER } from "./manage";

const USER = "00000000-0000-4000-8000-00000000a001";
const PORTFOLIO = "0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d";

interface FakeDatabaseOptions {
    /** The target account's source: "plaid" for a linked one. */
    source?: string;
    /** Whether a linked target account still syncs (its Plaid account picked and not revoked). */
    syncing?: boolean;
    /** The account's holdings valued by hand that an import may update, as stored. */
    handValued?: Array<Record<string, unknown>>;
    /** The account's positions besides AAPL. */
    positions?: string[];
    /** How many holdings valued by hand the user keeps before the import. */
    kept?: number;
}

/**
 * A database that holds AAPL already, and records what it was asked to
 * write. `accounts` are the user's accounts a new one is checked against.
 * Each lock it's asked for is named by its key: the user's account lock,
 * or the records lock of holdings valued by hand. `syncingQueries` are the
 * questions it was asked about which linked accounts still sync.
 */
function fakeDatabase(
    accounts: Array<{ id: string; name: string }> = [{ id: PORTFOLIO, name: "Brokerage" }],
    { source = "manual", syncing = true, handValued = [], positions = [], kept = 0 }: FakeDatabaseOptions = {},
) {
    const inserted: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const createdAccounts: Record<string, unknown>[] = [];
    const manualInserted: Record<string, unknown>[] = [];
    const manualUpdated: Record<string, unknown>[] = [];
    const values: Record<string, unknown>[] = [];
    const deleted: { sql: string; params: unknown[] }[] = [];
    const touched: Record<string, unknown>[] = [];
    const syncingQueries: { sql: string; params: unknown[] }[] = [];
    let locks = 0;
    const order: string[] = [];
    const dialect = new PgDialect();
    const tx = {
        execute: async (query: SQL) => {
            const key = String(dialect.sqlToQuery(query).params[0]);
            if (key.startsWith("atlas:records:manualHoldings:")) {
                order.push("records lock");
            } else {
                assert.ok(key.startsWith("atlas:accounts:"), key);
                locks++;
                order.push("account lock");
            }
        },
        select: (fields: Record<string, unknown>) => ({
            from: (table: unknown) => ({
                // Linked accounts that still sync (buildSyncingAccountsQuery).
                innerJoin: () => ({
                    where: async (condition: SQL) => {
                        assert.equal(table, portfolios);
                        syncingQueries.push(dialect.sqlToQuery(condition));
                        return syncing ? [{ id: PORTFOLIO }] : [];
                    },
                }),
                where: () => {
                    // The records limit's count.
                    if ("n" in fields) return Promise.resolve([{ n: kept + manualInserted.length }]);
                    if (table === portfolios) {
                        return {
                            limit: () => ({ for: async () => (order.push("row lock"), [{ id: PORTFOLIO, name: "Brokerage", source }]) }),
                            orderBy: async () => accounts,
                        };
                    }
                    if (table === manualHoldings) return { orderBy: async () => handValued };
                    return Promise.resolve([
                        { id: "h-1", symbol: "AAPL", quantity: "1", avgCost: "100" },
                        ...positions.map((symbol, i) => ({ id: `h-${i + 2}`, symbol, quantity: "1", avgCost: "1" })),
                    ]);
                },
            }),
        }),
        insert: (table: unknown) => ({
            values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
                const list = Array.isArray(rows) ? rows : [rows];
                if (table === holdings) inserted.push(...list);
                if (table === manualHoldings) manualInserted.push(...list);
                if (table === manualHoldingValues) values.push(...list);
                return Object.assign(Promise.resolve(), {
                    returning: async () => {
                        if (table === manualHoldings) return list.map((row, i) => ({ id: `m-new-${i}`, externalId: row.externalId }));
                        createdAccounts.push(rows as Record<string, unknown>);
                        return [{ id: "p-new" }];
                    },
                    onConflictDoUpdate: async () => undefined,
                });
            },
        }),
        update: (table: unknown) => ({
            set: (values: Record<string, unknown>) => ({
                where: async () => {
                    if (table === holdings) updated.push(values);
                    if (table === manualHoldings) manualUpdated.push(values);
                    if (table === portfolios) touched.push(values);
                },
            }),
        }),
        delete: (table: unknown) => ({
            where: async (condition: SQL) => {
                assert.equal(table, holdings);
                deleted.push(dialect.sqlToQuery(condition));
            },
        }),
    };
    const database = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as typeof db;
    return { database, inserted, updated, createdAccounts, manualInserted, manualUpdated, values, deleted, touched, syncingQueries, locks: () => locks, order };
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
        // Taken once by the import before anything else, and again (it's
        // re-entrant) by the name check for the new account.
        const fake = fakeDatabase();
        const result = await importHoldings(USER, { newPortfolioName: "Joint", rows }, {}, fake.database);
        assert.equal(result.createdPortfolio, true);
        assert.equal(result.portfolioId, "p-new");
        assert.equal(fake.locks(), 2);
        assert.equal(fake.order[0], "account lock");
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

    test("regression: importing into an existing account takes the account lock first, then the row lock", async () => {
        // A Plaid sync takes the user's account lock and then writes the
        // account's holdings and option positions; an import into that
        // linked account that locked its row first would take the two the
        // other way round, and the two could deadlock.
        const fake = fakeDatabase([]);
        await importHoldings(USER, { portfolioId: PORTFOLIO, rows }, {}, fake.database);
        assert.equal(fake.locks(), 1);
        assert.deepEqual(fake.order, ["account lock", "row lock"]);
    });

    test("regression: a batch that creates an account takes the account lock before any account's rows", async () => {
        // The Codex finding on PR #216: locking an existing account's row
        // and then the user's lock (for the new account's name) is the
        // reverse of a Plaid sync's order, so the two could deadlock.
        const fake = fakeDatabase([]);
        await importHoldingsToAccounts(USER, [{ portfolioId: PORTFOLIO, rows }, { newPortfolioName: "Joint", rows }], {}, fake.database);
        assert.equal(fake.order[0], "account lock");
        assert.ok(fake.order.indexOf("row lock") > 0);
    });

    test("a batch into existing accounts only takes the account lock once, first", async () => {
        const fake = fakeDatabase([]);
        await importHoldingsToAccounts(USER, [{ portfolioId: PORTFOLIO, rows }, { portfolioId: PORTFOLIO, rows }], {}, fake.database);
        assert.equal(fake.locks(), 1);
        assert.deepEqual(fake.order, ["account lock", "row lock", "row lock"]);
    });
});

describe("importHoldings with holdings valued by hand", () => {
    const fund = { name: "Target 2055 Trust", identifier: null, quantity: 250.5, value: 12345.67, costBasis: null };
    const position = { symbol: "MSFT", name: "Microsoft", quantity: 4, avgCost: 300 };
    const saved = {
        id: "m-1", name: "Target 2055 Trust", identifier: null, externalId: "csv:name:target 2055 trust",
        quantity: "250.5", value: "12000", costBasis: null, valueAsOf: "2026-11-01",
    };

    test("into an existing account: the account lock, then the records lock, before the account's row lock", async () => {
        // A Plaid sync and the card take the account lock first, then the
        // records lock; any other order with the row lock could deadlock.
        const fake = fakeDatabase();
        await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [], manual: [fund], valuesAsOf: "2026-11-02" }, {}, fake.database);
        assert.deepEqual(fake.order, ["account lock", "records lock", "row lock"]);
    });

    test("a body without them takes the account lock once and no records lock", async () => {
        const fake = fakeDatabase();
        await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [position] }, {}, fake.database);
        assert.deepEqual(fake.order, ["account lock", "row lock"]);
        assert.deepEqual(fake.manualInserted, []);
    });

    test("a batch in which any account has them takes the account lock, then the records lock, before any row", async () => {
        const fake = fakeDatabase([]);
        await importHoldingsToAccounts(USER, [{ portfolioId: PORTFOLIO, rows: [position] }, { newPortfolioName: "Workplace 401k", rows: [], manual: [fund] }], {}, fake.database);
        assert.deepEqual(fake.order.slice(0, 3), ["account lock", "records lock", "row lock"]);
        assert.equal(fake.manualInserted.length, 1);
    });

    test("into a linked account that still syncs they're refused and nothing is written; the file's positions alone still import", async () => {
        const fake = fakeDatabase(undefined, { source: "plaid" });
        await assert.rejects(
            importHoldings(USER, { portfolioId: PORTFOLIO, rows: [position], manual: [fund] }, {}, fake.database),
            (err: unknown) => err instanceof LinkedAccountImportError
                && err.message === "Brokerage is a linked account, so its holdings without a ticker come in with each sync. Import this file into another account.",
        );
        assert.deepEqual([fake.inserted.length, fake.manualInserted.length, fake.values.length, fake.touched.length], [0, 0, 0, 0]);
        // Asked of this account, the user's, under the locks.
        assert.equal(fake.syncingQueries.length, 1);
        assert.deepEqual(fake.syncingQueries[0].params, [USER, "plaid", "sync_ready", PORTFOLIO]);
        assert.deepEqual(fake.order, ["account lock", "records lock", "row lock"]);
        const positions = fakeDatabase(undefined, { source: "plaid" });
        assert.equal((await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [position] }, {}, positions.database)).insert, 1);
        assert.equal(positions.syncingQueries.length, 0);
    });

    test("regression: once a linked account no longer syncs (disconnected, revoked), they import, and update what its last sync brought in", async () => {
        // It stays a linked account in Atlas, but no sync replaces its
        // holdings any more: refusing the file left no way to update them.
        const synced = { ...saved, id: "m-synced", externalId: `${PORTFOLIO}:sec_trust`, value: "11000" };
        const fake = fakeDatabase(undefined, { source: "plaid", syncing: false, handValued: [synced] });
        const result = await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [position], manual: [fund], valuesAsOf: "2026-11-02" }, {}, fake.database);
        assert.equal(fake.syncingQueries.length, 1);
        assert.deepEqual(result.manual, { insert: 0, update: 1, unchanged: 0, replacedPositions: 0 });
        assert.deepEqual(fake.manualInserted, []);
        // Found by its name, and the file's from now on: the next file finds it by its key.
        assert.deepEqual(fake.manualUpdated.map(({ externalId, source, value, valueAsOf }) => ({ externalId, source, value, valueAsOf })), [
            { externalId: "csv:name:target 2055 trust", source: "csv", value: "12345.67", valueAsOf: "2026-11-02" },
        ]);
        assert.deepEqual(fake.values.map((v) => [v.manualHoldingId, v.date, v.value]), [["m-synced", "2026-11-02", "12345.67"]]);
    });

    test("an account that was never linked isn't asked whether it syncs", async () => {
        const fake = fakeDatabase();
        await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [], manual: [fund] }, {}, fake.database);
        assert.deepEqual([fake.syncingQueries.length, fake.manualInserted.length], [0, 1]);
    });

    test("a new one marks the account changed; a new value alone doesn't, new units or a new cost do", async () => {
        const added = fakeDatabase();
        await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [], manual: [fund] }, {}, added.database);
        assert.equal(added.touched.length, 1);

        const price = fakeDatabase(undefined, { handValued: [saved] });
        const result = await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [], manual: [fund], valuesAsOf: "2026-11-02" }, {}, price.database);
        assert.deepEqual(result.manual, { insert: 0, update: 1, unchanged: 0, replacedPositions: 0 });
        assert.equal(price.touched.length, 0);
        // Updated in place: the same holding, the new value and its day.
        assert.deepEqual(price.values, [{ manualHoldingId: "m-1", date: "2026-11-02", value: "12345.67", quantity: "250.5", recordedAt: price.values[0].recordedAt }]);

        for (const change of [{ quantity: 260 }, { costBasis: 9000 }]) {
            const fake = fakeDatabase(undefined, { handValued: [saved] });
            await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [], manual: [{ ...fund, ...change }], valuesAsOf: "2026-11-02" }, {}, fake.database);
            assert.equal(fake.touched.length, 1, JSON.stringify(change));
        }
    });

    test("the result counts them apart from positions, and a position held under the fund's CUSIP is deleted", async () => {
        const fake = fakeDatabase(undefined, { positions: ["99ZZ12341"] });
        const result = await importHoldings(USER, {
            portfolioId: PORTFOLIO,
            rows: [position],
            manual: [{ name: "Stable Value Fund", identifier: "99ZZ12341", quantity: null, value: 5000, costBasis: null }],
        }, {}, fake.database);
        assert.deepEqual([result.insert, result.update, result.unchanged], [1, 0, 0]);
        assert.deepEqual(result.manual, { insert: 1, update: 0, unchanged: 0, replacedPositions: 1 });
        assert.equal(fake.deleted.length, 1);
        assert.deepEqual(fake.deleted[0].params, [PORTFOLIO, "99ZZ12341"]);
        assert.deepEqual(fake.manualInserted.map((m) => [m.name, m.identifier, m.source, m.externalId]), [["Stable Value Fund", "99ZZ12341", "csv", "csv:id:99ZZ12341"]]);
        // Without hand-valued rows the result says none.
        const plain = await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [position] }, {}, fakeDatabase().database);
        assert.deepEqual(plain.manual, { insert: 0, update: 0, unchanged: 0, replacedPositions: 0 });
    });

    test("without valuesAsOf the values are as of today's date in UTC", async () => {
        const before = new Date().toISOString().slice(0, 10);
        const fake = fakeDatabase();
        await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [], manual: [fund] }, {}, fake.database);
        const after = new Date().toISOString().slice(0, 10);
        assert.ok([before, after].includes(String(fake.manualInserted[0].valueAsOf)));
        assert.equal(fake.values[0].date, fake.manualInserted[0].valueAsOf);
    });

    test("past the limit the import throws RecordLimitError, which rolls it back; a re-import that adds none goes through", async () => {
        const full = fakeDatabase(undefined, { kept: 1_000 });
        await assert.rejects(importHoldings(USER, { portfolioId: PORTFOLIO, rows: [position], manual: [fund] }, {}, full.database), RecordLimitError);
        const again = fakeDatabase(undefined, { kept: 1_000, handValued: [saved] });
        const result = await importHoldings(USER, { portfolioId: PORTFOLIO, rows: [], manual: [fund] }, {}, again.database);
        assert.equal(result.manual.update, 1);
    });
});
