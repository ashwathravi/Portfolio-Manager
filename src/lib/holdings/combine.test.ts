import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { combineBySymbol, parseHoldingsRowView, type AccountPosition } from "./combine";

function position(
    overrides: Partial<AccountPosition> & Pick<AccountPosition, "id" | "symbol" | "account" | "quantity">,
    avgCost: number,
): AccountPosition & { name: string } {
    const last = overrides.last === undefined ? 190 : overrides.last;
    const costBasis = overrides.quantity * avgCost;
    return {
        name: `${overrides.symbol} Inc.`,
        last,
        costBasis,
        marketValue: last === null ? costBasis : overrides.quantity * last,
        todayPct: null,
        todayChangeAbs: 0,
        allocationPct: 0,
        ...overrides,
    };
}

describe("holdings / parseHoldingsRowView", () => {
    it("is one row per symbol only for ?view=symbol", () => {
        assert.equal(parseHoldingsRowView("symbol"), "symbol");
        for (const value of [undefined, "", "account", "SYMBOL", ["symbol"], 1]) {
            assert.equal(parseHoldingsRowView(value), "account");
        }
    });
});

describe("holdings / combineBySymbol", () => {
    it("adds up shares, cost and value, and blends the cost per share", () => {
        const [aapl] = combineBySymbol([
            position({ id: "h1", symbol: "AAPL", account: "Main Portfolio", quantity: 500 }, 165.3),
            position({ id: "h2", symbol: "AAPL", account: "Roth IRA", quantity: 100 }, 200),
        ]);
        assert.equal(aapl.id, "symbol:AAPL");
        assert.equal(aapl.quantity, 600);
        assert.equal(aapl.costBasis, 102_650);
        assert.equal(aapl.avgCost.toFixed(4), "171.0833");
        assert.equal(aapl.marketValue, 114_000);
        assert.equal(aapl.last, 190);
        assert.equal(aapl.totalReturnPct?.toFixed(2), "11.06");
        assert.equal(aapl.partlyAtCost, false);
        assert.deepEqual(aapl.accounts, ["Main Portfolio", "Roth IRA"]);
    });

    it("keeps a symbol held in one account as it was, under the symbol's ID", () => {
        const [msft] = combineBySymbol([position({ id: "h1", symbol: "MSFT", account: "Main Portfolio", quantity: 10 }, 300)]);
        assert.equal(msft.id, "symbol:MSFT");
        assert.equal(msft.quantity, 10);
        assert.equal(msft.avgCost, 300);
        assert.equal(msft.last, 190);
        assert.deepEqual(msft.accounts, ["Main Portfolio"]);
    });

    it("groups symbols in any letter case, in the order they first appear", () => {
        const rows = combineBySymbol([
            position({ id: "h1", symbol: "msft", account: "A", quantity: 1 }, 1),
            position({ id: "h2", symbol: "AAPL", account: "A", quantity: 1 }, 1),
            position({ id: "h3", symbol: "MSFT", account: "B", quantity: 2 }, 1),
        ]);
        assert.deepEqual(rows.map((r) => [r.id, r.quantity]), [["symbol:MSFT", 3], ["symbol:AAPL", 1]]);
        // The symbol as first written, with what belongs to it.
        assert.equal(rows[0].symbol, "msft");
        assert.equal(rows[0].name, "msft Inc.");
    });

    it("names each account once", () => {
        const [row] = combineBySymbol([
            position({ id: "h1", symbol: "AAPL", account: "Main", quantity: 1 }, 1),
            position({ id: "h2", symbol: "AAPL", account: "Main", quantity: 1 }, 1),
            position({ id: "h3", symbol: "AAPL", account: "Roth", quantity: 1 }, 1),
        ]);
        assert.deepEqual(row.accounts, ["Main", "Roth"]);
    });

    it("adds up allocation and today's P&L, and keeps the symbol's move today", () => {
        const [row] = combineBySymbol([
            position({ id: "h1", symbol: "AAPL", account: "A", quantity: 500, todayPct: 1.06, todayChangeAbs: 1000, allocationPct: 12.5 }, 1),
            position({ id: "h2", symbol: "AAPL", account: "B", quantity: 100, todayPct: 1.06, todayChangeAbs: 200, allocationPct: 2.5 }, 1),
        ]);
        assert.equal(row.todayPct, 1.06);
        assert.equal(row.todayChangeAbs, 1200);
        assert.equal(row.allocationPct, 15);
    });

    it("has no move today when no account has one", () => {
        const [row] = combineBySymbol([
            position({ id: "h1", symbol: "AAPL", account: "A", quantity: 1 }, 1),
            position({ id: "h2", symbol: "AAPL", account: "B", quantity: 1 }, 1),
        ]);
        assert.equal(row.todayPct, null);
    });

    it("without any price, is valued at cost with no price and no return", () => {
        const [row] = combineBySymbol([
            position({ id: "h1", symbol: "ZZZQ", account: "A", quantity: 10, last: null }, 12.5),
            position({ id: "h2", symbol: "ZZZQ", account: "B", quantity: 10, last: null }, 7.5),
        ]);
        assert.equal(row.last, null);
        assert.equal(row.marketValue, 200);
        assert.equal(row.totalReturnPct, null);
        assert.equal(row.partlyAtCost, false);
    });

    it("with a price for some shares only, says so and returns over the priced shares", () => {
        const [row] = combineBySymbol([
            position({ id: "h1", symbol: "AAPL", account: "Plaid", quantity: 10, last: 120 }, 100),
            position({ id: "h2", symbol: "AAPL", account: "Import", quantity: 10, last: null }, 150),
        ]);
        assert.equal(row.partlyAtCost, true);
        assert.equal(row.last, 120);
        // 10 at $120 plus 10 at their $150 cost.
        assert.equal(row.marketValue, 2700);
        assert.equal(row.totalReturnPct, 20);
    });

    it("with different stored prices, prices it at what its value implies", () => {
        const [row] = combineBySymbol([
            position({ id: "h1", symbol: "AAPL", account: "A", quantity: 30, last: 100 }, 90),
            position({ id: "h2", symbol: "AAPL", account: "B", quantity: 10, last: 140 }, 90),
        ]);
        // 30 × 100 + 10 × 140 = 4,400 over 40 shares.
        assert.equal(row.marketValue, 4400);
        assert.equal(row.last, 110);
        assert.equal(row.partlyAtCost, false);
    });

    it("has no cost per share when the shares net to zero", () => {
        const [row] = combineBySymbol([
            position({ id: "h1", symbol: "AAPL", account: "A", quantity: 5 }, 100),
            position({ id: "h2", symbol: "AAPL", account: "B", quantity: -5 }, 100),
        ]);
        assert.equal(row.quantity, 0);
        assert.equal(row.avgCost, 0);
    });

    it("is empty without positions", () => {
        assert.deepEqual(combineBySymbol([]), []);
    });
});
