import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";
import { optionPositionSchema } from "@/lib/validators/option-position";

import {
    addOptionPosition,
    buildDeleteOptionPositionQuery,
    buildUserOptionPositionsQuery,
    DuplicateOptionPositionError,
    importOptionRows,
    loadOptionPositions,
    loadThesisChoices,
    updateOptionPosition,
} from "./option-positions-store";
import { AccountNotFoundError } from "./transactionsWrite";

const USER = "00000000-0000-4000-8000-00000000a001";
const ACCOUNT = "0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d";
const AAPL_CALL = "O:AAPL270115C00250000";
const NOW = new Date("2026-11-05T15:00:00.000Z");

const POSITION = optionPositionSchema.parse({ underlying: "AAPL", contractType: "call", strike: 250, expiry: "2027-01-15", quantity: 3, premium: 18.2 });

/** A query builder whose every step returns itself, and which resolves to `result` (or rejects with it). */
function chain(result: unknown): unknown {
    const proxy: unknown = new Proxy({}, {
        get(_target, prop) {
            if (prop === "then") {
                return (resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
                    (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject);
            }
            return () => proxy;
        },
    });
    return proxy;
}

/** A database answering its selects in order, recording what's inserted and set. */
function fakeDatabase({ selects = [] as unknown[], insert = [{ id: "p-new" }] as unknown, updated = [{ id: "p-1" }] as unknown } = {}) {
    const queue = [...selects];
    const inserted: unknown[] = [];
    const set: Record<string, unknown>[] = [];
    let selected = 0;
    const tx = {
        select: () => {
            selected++;
            return chain(queue.shift() ?? []);
        },
        insert: () => ({ values: (values: unknown) => { inserted.push(values); return chain(insert); } }),
        update: () => ({ set: (values: Record<string, unknown>) => { set.push(values); return chain(updated); } }),
    };
    const database = { ...tx, transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as typeof db;
    return { database, tx: tx as unknown as typeof db, inserted, set, selects: () => selected };
}

const OWNS = [{ id: ACCOUNT }];

describe("the user's option positions query", () => {
    test("reads only the user's positions, with their own account's name and the contract's stored close", () => {
        const { sql, params } = buildUserOptionPositionsQuery(USER).toSQL();
        assert.match(sql, /inner join "portfolios" on \("portfolios"\."id" = "option_positions"\."portfolio_id" and "portfolios"\."user_id" = "option_positions"\."user_id"\)/);
        assert.match(sql, /left join "option_marks" on "option_marks"\."contract" = "option_positions"\."contract"/);
        assert.match(sql, /where "option_positions"\."user_id" = \$1 order by "option_positions"\."expiry" asc/);
        assert.deepEqual(params, [USER]);
    });

    test("deletes only one of the user's positions", () => {
        const { sql, params } = buildDeleteOptionPositionQuery(USER, "p-1").toSQL();
        assert.equal(sql, 'delete from "option_positions" where ("option_positions"."id" = $1 and "option_positions"."user_id" = $2) returning "id"');
        assert.deepEqual(params, ["p-1", USER]);
    });
});

describe("loadOptionPositions", () => {
    const row = (overrides: Record<string, unknown> = {}, mark: { close: number | null; closeDate: string | null } = { close: null, closeDate: null }) => ({
        position: {
            id: "p-1", userId: USER, portfolioId: ACCOUNT, contract: AAPL_CALL, underlying: "AAPL", contractType: "call",
            strike: "250", expiry: "2027-01-15", quantity: "3", premium: "18.2", multiplier: 100, openedAt: null,
            userMark: null, userMarkDate: null, thesisId: null, expiryTest: "", exitRule: "", source: "manual",
            createdAt: NOW, updatedAt: NOW, ...overrides,
        },
        account: "Brokerage",
        ...mark,
    });

    test("marks each position, names its thesis and prices its underlying", async () => {
        const asked: string[][] = [];
        const { database } = fakeDatabase({
            selects: [
                [
                    row({ thesisId: "t-own" }, { close: 21.4, closeDate: "2026-10-16" }),
                    row({ id: "p-2", contract: "O:AAPL270115C00300000", strike: "300", thesisId: "t-gone", userMark: "2", userMarkDate: "2026-11-04" }),
                ],
                [{ id: "t-own", title: "Services margin" }],
            ],
        });
        const loaded = await loadOptionPositions(USER, {
            database,
            quotes: async (symbols) => {
                asked.push(symbols);
                return { AAPL: { price: 231.5 } };
            },
        });
        assert.deepEqual(asked, [["AAPL"]]);
        assert.deepEqual(loaded.map((p) => [p.id, p.strike, p.quantity, p.premium, p.thesisTitle, p.underlyingPrice, p.mark]), [
            ["p-1", 250, 3, 18.2, "Services margin", 231.5, { source: "close", price: 21.4, date: "2026-10-16" }],
            // A deleted (or another user's) thesis has no title: the ledger asks for one.
            ["p-2", 300, 3, 18.2, null, 231.5, { source: "user", price: 2, date: "2026-11-04" }],
        ]);
    });

    test("no positions: nothing else is read", async () => {
        const { database, selects } = fakeDatabase({ selects: [[]] });
        let quoted = false;
        assert.deepEqual(await loadOptionPositions(USER, { database, quotes: async () => { quoted = true; return {}; } }), []);
        assert.equal(selects(), 1);
        assert.equal(quoted, false);
    });
});

describe("loadThesisChoices", () => {
    test("the theses the user wrote, not the examples", async () => {
        const { database } = fakeDatabase({ selects: [[{ id: "seed-nvda", ticker: "NVDA", title: "AI" }, { id: "t-own", ticker: "AAPL", title: "Services" }]] });
        assert.deepEqual(await loadThesisChoices(USER, database), [{ id: "t-own", ticker: "AAPL", title: "Services" }]);
    });
});

describe("addOptionPosition", () => {
    test("adds the position to the user's account, under Massive's name for the contract", async () => {
        const { database, inserted } = fakeDatabase({ selects: [OWNS] });
        assert.equal(await addOptionPosition(USER, ACCOUNT, POSITION, database), "p-new");
        assert.deepEqual(inserted, [{
            userId: USER, portfolioId: ACCOUNT, contract: AAPL_CALL, underlying: "AAPL", contractType: "call",
            strike: "250", expiry: "2027-01-15", quantity: "3", premium: "18.2", multiplier: 100, openedAt: null,
            userMark: null, userMarkDate: null, thesisId: null, expiryTest: "", exitRule: "", source: "manual",
        }]);
    });

    test("regression: another user's account is refused and nothing is written", async () => {
        const { database, inserted } = fakeDatabase({ selects: [[]] });
        await assert.rejects(addOptionPosition(USER, ACCOUNT, POSITION, database), AccountNotFoundError);
        assert.deepEqual(inserted, []);
    });

    test("the same contract twice in an account is a duplicate; any other failure is passed on", async () => {
        const unique = Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "option_positions_portfolio_contract_idx" });
        await assert.rejects(
            addOptionPosition(USER, ACCOUNT, POSITION, fakeDatabase({ selects: [OWNS], insert: unique }).database),
            (error: unknown) => error instanceof DuplicateOptionPositionError && error.contract === AAPL_CALL,
        );
        const wrapped = Object.assign(new Error("query failed"), { cause: unique });
        await assert.rejects(addOptionPosition(USER, ACCOUNT, POSITION, fakeDatabase({ selects: [OWNS], insert: wrapped }).database), DuplicateOptionPositionError);
        await assert.rejects(addOptionPosition(USER, ACCOUNT, POSITION, fakeDatabase({ selects: [OWNS], insert: new Error("down") }).database), /down/);
    });
});

describe("updateOptionPosition", () => {
    test("saves the position as the form has it, into the account chosen", async () => {
        const { database, set } = fakeDatabase({ selects: [OWNS] });
        const marked = { ...POSITION, quantity: -2, userMark: 20, userMarkDate: "2026-11-04" };
        assert.equal(await updateOptionPosition(USER, "p-1", ACCOUNT, marked, { database, now: NOW }), true);
        assert.deepEqual([set[0].portfolioId, set[0].contract, set[0].quantity, set[0].userMark, set[0].userMarkDate, set[0].updatedAt], [ACCOUNT, AAPL_CALL, "-2", "20", "2026-11-04", NOW]);
    });

    test("a position the user doesn't have is false; an account that isn't theirs is refused", async () => {
        assert.equal(await updateOptionPosition(USER, "p-x", ACCOUNT, POSITION, { database: fakeDatabase({ selects: [OWNS], updated: [] }).database }), false);
        const notTheirs = fakeDatabase({ selects: [[]] });
        await assert.rejects(updateOptionPosition(USER, "p-1", ACCOUNT, POSITION, { database: notTheirs.database }), AccountNotFoundError);
        assert.deepEqual(notTheirs.set, []);
    });
});

describe("importOptionRows", () => {
    const row = (strike: number, quantity: number, premium: number) => ({ underlying: "AAPL", contractType: "call" as const, strike, expiry: "2027-01-15", quantity, premium });

    test("a snapshot of the account: new contracts added, changed ones updated, the rest left as they are", async () => {
        const { tx, inserted, set } = fakeDatabase({
            selects: [[
                { id: "p-same", contract: "O:AAPL270115C00250000", quantity: "3", premium: "18.2" },
                { id: "p-changed", contract: "O:AAPL270115C00300000", quantity: "1", premium: "9" },
            ]],
        });
        const result = await importOptionRows(tx, USER, ACCOUNT, [row(250, 3, 18.2), row(300, 2, 8.5), row(350, -1, 4)], NOW);
        assert.deepEqual(result, { insert: 1, update: 1, unchanged: 1 });
        // Only what the file says: the thesis, rules and the user's own price stay.
        assert.deepEqual(set, [{ quantity: "2", premium: "8.5", updatedAt: NOW }]);
        assert.deepEqual(inserted, [[{
            userId: USER, portfolioId: ACCOUNT, contract: "O:AAPL270115C00350000", underlying: "AAPL", contractType: "call",
            strike: "350", expiry: "2027-01-15", quantity: "-1", premium: "4", multiplier: 100, source: "csv",
        }]]);
    });

    test("a file without option rows reads nothing", async () => {
        const { tx, selects } = fakeDatabase();
        assert.deepEqual(await importOptionRows(tx, USER, ACCOUNT, [], NOW), { insert: 0, update: 0, unchanged: 0 });
        assert.equal(selects(), 0);
    });
});
