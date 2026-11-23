import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sortHoldings, type SortableHolding } from "./sort";

/** A row worth `marketValue` in account A unless given, with no return or move. */
function row(symbol: string, marketValue: number, overrides: Partial<SortableHolding> = {}): SortableHolding {
    return {
        symbol,
        accountId: "a",
        account: "A",
        marketValue,
        totalReturnPct: null,
        todayPct: null,
        allocationPct: 0,
        ...overrides,
    };
}

const describeRows = (rows: readonly SortableHolding[]) => rows.map((r) => `${r.symbol} ${r.account} ${r.accountId}`);

describe("holdings / sortHoldings", () => {
    it("market value, largest first; equal values go by symbol, then account name, then account ID, whatever order they came in", () => {
        const rows = [
            row("ZQB", 10, { account: "Brokerage", accountId: "p1" }),
            row("ZQA", 10, { account: "Roth IRA", accountId: "p2" }),
            row("ZQA", 10, { account: "brokerage", accountId: "p3" }),
            row("BIGX", 1_000),
            row("ZQA", 10, { account: "Brokerage", accountId: "p1" }),
        ];
        const expected = [
            "BIGX A a",
            // Account names compare without case, so their IDs decide.
            "ZQA Brokerage p1",
            "ZQA brokerage p3",
            "ZQA Roth IRA p2",
            "ZQB Brokerage p1",
        ];
        for (const order of [rows, [...rows].reverse(), [rows[2], rows[4], rows[0], rows[3], rows[1]]]) {
            assert.deepEqual(describeRows(sortHoldings(order, "marketValue")), expected);
        }
    });

    it("total return and today: rows without one sort last, in symbol order", () => {
        const rows = [
            row("NONB", 5),
            row("DOWN", 5, { totalReturnPct: -12, todayPct: -1.5 }),
            row("NONA", 900),
            row("UP", 5, { totalReturnPct: 30, todayPct: 0.4 }),
            row("FLAT", 5, { totalReturnPct: 0, todayPct: 0 }),
        ];
        assert.deepEqual(sortHoldings(rows, "totalReturnPct").map((r) => r.symbol), ["UP", "FLAT", "DOWN", "NONA", "NONB"]);
        assert.deepEqual(sortHoldings(rows, "todayPct").map((r) => r.symbol), ["UP", "FLAT", "DOWN", "NONA", "NONB"]);
    });

    it("allocation, largest first", () => {
        const rows = [row("SML", 1, { allocationPct: 0.1 }), row("BIG", 1, { allocationPct: 60 }), row("MID", 1, { allocationPct: 39.9 })];
        assert.deepEqual(sortHoldings(rows, "allocationPct").map((r) => r.symbol), ["BIG", "MID", "SML"]);
    });

    it("returns a new array and leaves the one given alone", () => {
        const rows = [row("SML", 1), row("BIG", 100)];
        const sorted = sortHoldings(rows, "marketValue");
        assert.notEqual(sorted, rows);
        assert.deepEqual(rows.map((r) => r.symbol), ["SML", "BIG"]);
        assert.deepEqual(sorted.map((r) => r.symbol), ["BIG", "SML"]);
        // The same rows, not copies.
        assert.equal(sorted[0], rows[1]);
    });
});
