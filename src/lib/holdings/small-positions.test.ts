import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { combineBySymbol, type AccountPosition } from "./combine";
import {
    formatAllocationPct,
    formatSmallPositionValue,
    SMALL_POSITIONS_RULE,
    smallPositionsLimitLabel,
    smallPositionsLimits,
    splitSmallPositions,
    type SmallPositionCandidate,
} from "./small-positions";

type Row = SmallPositionCandidate & { symbol: string };

/** A row worth `marketValue`, valued at cost unless overridden; its account's ID is its name unless given. */
function row(symbol: string, marketValue: number, overrides: Partial<Row> = {}): Row {
    const account = overrides.account ?? "A";
    return {
        symbol,
        accountId: account,
        account,
        marketValue,
        costBasis: marketValue,
        last: null,
        totalReturnPct: null,
        todayPct: null,
        todayChangeAbs: 0,
        allocationPct: 0,
        ...overrides,
    };
}

/** One account's position for combineBySymbol, priced at `last` (null: at cost). */
function position(
    symbol: string,
    account: string,
    quantity: number,
    avgCost: number,
    last: number | null,
): AccountPosition & SmallPositionCandidate {
    const costBasis = quantity * avgCost;
    const marketValue = last === null ? costBasis : quantity * last;
    return {
        id: `${account}:${symbol}`,
        symbol,
        accountId: account,
        account,
        quantity,
        costBasis,
        marketValue,
        last,
        totalReturnPct: last !== null && avgCost > 0 ? ((last - avgCost) / avgCost) * 100 : null,
        todayPct: null,
        todayChangeAbs: 0,
        allocationPct: 0,
    };
}

const symbolsOf = (rows: readonly { symbol: string }[]) => rows.map((r) => r.symbol);

describe("holdings / splitSmallPositions", () => {
    it("groups positions worth under $500 and under 0.5% of the market value, keeping the order given", () => {
        const rows = [row("BIGX", 120_000), row("BIGY", 79_700), row("SMLA", 150), row("SMLB", 90), row("SMLC", 60)];
        const { shown, small } = splitSmallPositions(rows, 200_000);
        assert.deepEqual(symbolsOf(shown), ["BIGX", "BIGY"]);
        assert.ok(small);
        assert.deepEqual(symbolsOf(small.rows), ["SMLA", "SMLB", "SMLC"]);
        // 0.5% of $200,000 is $1,000, so the dollar limit is the lower one.
        assert.equal(small.limit, 500);
        assert.equal(small.limitedBy, "value");
    });

    it("in a large book the dollar limit holds: 600 in a 1,000,000 book (0.06%) stays a row while 499 is small", () => {
        const rows = [row("BIGX", 998_201), row("MIDX", 600), row("SMLA", 499), row("SMLB", 400), row("SMLC", 300)];
        const { shown, small } = splitSmallPositions(rows, 1_000_000);
        assert.deepEqual(symbolsOf(shown), ["BIGX", "MIDX"]);
        assert.deepEqual(symbolsOf(small?.rows ?? []), ["SMLA", "SMLB", "SMLC"]);
        assert.equal(small?.limitedBy, "value");
    });

    it("in a small book the share limit holds: in 5,000 the limit is 25, so 40 (0.8%) stays a row and 24.99 is small", () => {
        const rows = [row("BIGX", 4_905.01), row("MIDX", 40), row("SMLA", 24.99), row("SMLB", 20), row("SMLC", 10)];
        const { shown, small } = splitSmallPositions(rows, 5_000);
        assert.deepEqual(symbolsOf(shown), ["BIGX", "MIDX"]);
        assert.deepEqual(symbolsOf(small?.rows ?? []), ["SMLA", "SMLB", "SMLC"]);
        assert.equal(small?.limit, 25);
        assert.equal(small?.limitedBy, "share");
    });

    it("a position worth exactly the limit is not small", () => {
        const large = splitSmallPositions([row("BIGX", 998_800), row("EDGE", 500), row("SMLA", 400), row("SMLB", 200), row("SMLC", 100)], 1_000_000);
        assert.deepEqual(symbolsOf(large.shown), ["BIGX", "EDGE"]);
        const tiny = splitSmallPositions([row("BIGX", 4_925), row("EDGE", 25), row("SMLA", 24), row("SMLB", 20), row("SMLC", 6)], 5_000);
        assert.deepEqual(symbolsOf(tiny.shown), ["BIGX", "EDGE"]);
    });

    it("regression: no grouped position reads as the limit its group says it is under", () => {
        // A $1,000,000 book, limited by value. The open group writes values
        // to the cent: $499.996 would read $500.00 under "Each under $500",
        // so it stays a row, and $499.99 is small.
        const large = splitSmallPositions([row("BIGX", 998_500), row("EDGE", 499.996), row("SMLA", 499.99), row("SMLB", 300), row("SMLC", 200)], 1_000_000);
        assert.deepEqual(symbolsOf(large.shown), ["BIGX", "EDGE"]);
        assert.deepEqual(symbolsOf(large.small?.rows ?? []), ["SMLA", "SMLB", "SMLC"]);
        assert.equal(large.small?.limitedBy, "value");
        assert.equal(formatSmallPositionValue(499.996), "$500.00");
        assert.equal(formatSmallPositionValue(499.99), "$499.99");

        // A $40,000 book, limited by share ($200). $199 is 0.4975%, which
        // reads 0.50% under "Each under 0.5% of market value", so it stays a
        // row; $197.90 reads 0.49%.
        const book = 40_000;
        const held = (symbol: string, value: number) => row(symbol, value, { allocationPct: (value / book) * 100 });
        const small = splitSmallPositions([held("BIGX", 39_313.1), held("EDGE", 199), held("NEAR", 197.9), held("SMLA", 190), held("SMLB", 100)], book);
        assert.deepEqual(symbolsOf(small.shown), ["BIGX", "EDGE"]);
        assert.deepEqual(symbolsOf(small.small?.rows ?? []), ["NEAR", "SMLA", "SMLB"]);
        assert.equal(small.small?.limitedBy, "share");
        assert.deepEqual(small.small?.rows.map((r) => formatAllocationPct(r.allocationPct)), ["0.49%", "0.47%", "0.25%"]);
        assert.equal(formatAllocationPct((199 / book) * 100), "0.50%");
    });

    it("keeps out only positions that read as a limit: every grouped one reads under both", () => {
        const readsUnder = (r: Row) =>
            Number(formatSmallPositionValue(r.marketValue).replace(/[$,]/g, "")) < SMALL_POSITIONS_RULE.maxValue
            && parseFloat(formatAllocationPct(r.allocationPct)) < SMALL_POSITIONS_RULE.maxShare * 100;
        for (const book of [5_000, 40_000, 99_999, 100_000, 250_000, 2_000_000]) {
            const limit = Math.min(SMALL_POSITIONS_RULE.maxValue, SMALL_POSITIONS_RULE.maxShare * book);
            const held = (symbol: string, value: number) => row(symbol, value, { allocationPct: (value / book) * 100 });
            // From $3 under the limit to $1 over it, a tenth of a cent apart,
            // beside a large position and three that are plainly small.
            const rows = [
                held("BIGX", book / 2),
                ...[1, 2, 3].map((value) => held(`TINY${value}`, value)),
                ...Array.from({ length: 4_000 }, (_, i) => held(`NEAR${i}`, limit - 3 + i / 1_000)),
            ];
            const { shown, small } = splitSmallPositions(rows, book);
            assert.ok(small, `a group in a $${book} book`);
            for (const r of small.rows) assert.ok(readsUnder(r), `${r.marketValue} in a $${book} book is grouped but reads as a limit`);
            for (const r of shown) {
                if (r.marketValue < limit) assert.ok(!readsUnder(r), `${r.marketValue} in a $${book} book reads under both limits but isn't grouped`);
            }
        }
    });

    it("two small positions stay rows; a third makes the group", () => {
        const two = [row("BIGX", 100_000), row("SMLA", 10), row("SMLB", 20)];
        assert.deepEqual(splitSmallPositions(two, 100_030), { shown: two, small: null });
        const three = [...two, row("SMLC", 30)];
        const { shown, small } = splitSmallPositions(three, 100_060);
        assert.deepEqual(symbolsOf(shown), ["BIGX"]);
        assert.deepEqual(symbolsOf(small?.rows ?? []), ["SMLA", "SMLB", "SMLC"]);
    });

    it("never groups every position: rows that are all small, against the whole book (a filter showing only them), stay rows", () => {
        // A sector filter leaving only the small positions of a $100,000 book.
        const rows = [row("SMLA", 10), row("SMLB", 20), row("SMLC", 30), row("SMLD", 40)];
        const { shown, small } = splitSmallPositions(rows, 100_000);
        assert.equal(small, null);
        assert.deepEqual(shown, rows);
        // A new array, so the table never holds on to the one given.
        assert.notEqual(shown, rows);
    });

    it("the limit comes from the market value given, not the rows given", () => {
        // A filter shows one $25,000 row with the small ones: $150 is 0.6% of
        // what's shown, but small against the $200,000 book.
        const rows = [row("BIGX", 25_000), row("SMLA", 150), row("SMLB", 90), row("SMLC", 60)];
        const { shown, small } = splitSmallPositions(rows, 200_000);
        assert.deepEqual(symbolsOf(shown), ["BIGX"]);
        assert.deepEqual(symbolsOf(small?.rows ?? []), ["SMLA", "SMLB", "SMLC"]);
    });

    it("groups nothing for an empty table, or a market value of 0, below 0, or NaN", () => {
        assert.deepEqual(splitSmallPositions([], 100_000), { shown: [], small: null });
        const rows = [row("BIGX", 100), row("SMLA", 0), row("SMLB", 0), row("SMLC", 0)];
        for (const marketValue of [0, -1_000, Number.NaN]) {
            assert.deepEqual(splitSmallPositions(rows, marketValue), { shown: rows, small: null }, String(marketValue));
        }
    });

    it("a short (worth less than nothing) is never small; a position worth 0 is", () => {
        const rows = [row("BIGX", 100_000), row("SHRT", -50), row("ZERO", 0), row("SMLA", 10), row("SMLB", 20)];
        const { shown, small } = splitSmallPositions(rows, 100_000);
        assert.deepEqual(symbolsOf(shown), ["BIGX", "SHRT"]);
        assert.deepEqual(symbolsOf(small?.rows ?? []), ["ZERO", "SMLA", "SMLB"]);
    });

    it("loses and duplicates nothing, and every total stays the same", () => {
        // 200 rows from a fixed sequence: a few large, most worth $0 to $999.
        let seed = 7;
        const next = () => {
            seed = (seed * 48_271) % 2_147_483_647;
            return seed;
        };
        const rows = Array.from({ length: 200 }, (_, i) => row(`S${i}`, i % 25 === 0 ? 50_000 + (next() % 50_000) : next() % 1_000));
        const total = rows.reduce((sum, r) => sum + r.marketValue, 0);
        const { shown, small } = splitSmallPositions(rows, total);
        assert.ok(small, "some rows are small");
        const all = [...shown, ...small.rows];
        assert.equal(all.length, rows.length);
        assert.equal(new Set(all).size, rows.length);
        for (const r of rows) assert.ok(all.includes(r), r.symbol);
        assert.equal(shown.reduce((sum, r) => sum + r.marketValue, 0) + small.marketValue, total);
        assert.ok(small.rows.every((r) => r.marketValue >= 0 && r.marketValue < small.limit));
        assert.ok(shown.every((r) => r.marketValue >= small.limit));
        // Each list keeps the order the rows came in.
        assert.deepEqual(shown, rows.filter((r) => shown.includes(r)));
        assert.deepEqual(small.rows, rows.filter((r) => small.rows.includes(r)));
    });

    it("adds up the group's value, cost, allocation and today's P&L", () => {
        const { small } = splitSmallPositions([
            row("BIGX", 100_000, { allocationPct: 99.7 }),
            row("SMLA", 120, { costBasis: 100, last: 12, allocationPct: 0.12, todayChangeAbs: 2, todayPct: 1.7 }),
            row("SMLB", 50, { allocationPct: 0.05 }),
            row("SMLC", 130, { costBasis: 140, last: 13, allocationPct: 0.13, todayChangeAbs: -1, todayPct: -0.8 }),
        ], 100_300);
        assert.ok(small);
        assert.equal(small.marketValue, 300);
        assert.equal(small.costBasis, 290);
        assert.equal(small.allocationPct.toFixed(2), "0.30");
        assert.equal(small.todayChangeAbs, 1);
    });

    it("weights today's move by value over the positions with one; null when none moved", () => {
        const book = [row("BIGX", 100_000)];
        const { small } = splitSmallPositions([
            ...book,
            // +10 on a previous 90, −5 on a previous 55, and one with no move today.
            row("SMLA", 100, { last: 10, todayChangeAbs: 10, todayPct: 11.11 }),
            row("SMLB", 50, { last: 5, todayChangeAbs: -5, todayPct: -9.09 }),
            row("SMLC", 80, { last: 8 }),
        ], 100_230);
        // +5 on 145.
        assert.equal(small?.todayPct?.toFixed(2), "3.45");

        const still = splitSmallPositions([...book, row("SMLA", 10), row("SMLB", 20), row("SMLC", 30)], 100_060);
        assert.equal(still.small?.todayPct, null);
    });

    it("total return is over the positions that show one", () => {
        const book = [row("BIGX", 100_000)];
        // 120 on a cost of 100, beside 50 valued at cost (no price, no return).
        const partly = splitSmallPositions([
            ...book,
            row("SMLA", 120, { costBasis: 100, last: 12, totalReturnPct: 20 }),
            row("SMLB", 50),
            row("SMLC", 30),
        ], 100_200).small;
        assert.equal(partly?.totalReturnPct?.toFixed(2), "20.00");
        assert.equal(partly?.atCost, false);
        assert.equal(partly?.partlyAtCost, true);

        const atCost = splitSmallPositions([...book, row("SMLA", 10), row("SMLB", 20), row("SMLC", 30)], 100_060).small;
        assert.equal(atCost?.atCost, true);
        assert.equal(atCost?.partlyAtCost, false);
        assert.equal(atCost?.totalReturnPct, null);

        // A position bought for nothing has a price but no return of its own,
        // as its row shows a dash, so it's left out.
        const free = splitSmallPositions([
            ...book,
            row("SMLA", 120, { costBasis: 100, last: 12, totalReturnPct: 20 }),
            row("GIFT", 40, { costBasis: 0, last: 4 }),
            row("SMLC", 60, { costBasis: 50, last: 6, totalReturnPct: 20 }),
        ], 100_220).small;
        assert.equal(free?.totalReturnPct?.toFixed(2), "20.00");
        assert.equal(free?.atCost, false);
        assert.equal(free?.partlyAtCost, false);
    });

    it("By symbol: uses the priced value and cost combineBySymbol gives a symbol partly at cost", () => {
        const combined = combineBySymbol([
            position("BIGX", "A", 10_000, 90, 100),
            // 10 shares at $120 on $100, plus 10 at their $150 cost: +20%.
            position("SMLA", "A", 10, 100, 120),
            position("SMLA", "B", 10, 150, null),
            position("SMLB", "A", 10, 5, null),
            position("SMLC", "A", 10, 6, null),
        ]);
        // Each $2,700 or less is small under a $5,000 limit.
        const { small } = splitSmallPositions(combined, 1_002_810, { ...SMALL_POSITIONS_RULE, maxValue: 5_000 });
        assert.deepEqual(symbolsOf(small?.rows ?? []), ["SMLA", "SMLB", "SMLC"]);
        // Not (2,700 − 2,500) / 2,500 = 8%: the shares at cost have no return.
        assert.equal(small?.totalReturnPct?.toFixed(2), "20.00");
        assert.equal(small?.partlyAtCost, true);
        assert.deepEqual(small?.accounts, [{ id: "A", name: "A" }, { id: "B", name: "B" }]);
    });

    it("By symbol judges a symbol across its accounts", () => {
        // $99,600 in all, so the limit is 0.5% of it: $498.
        const positions = [
            position("BIGX", "A", 990, 100, null),
            position("SMLA", "A", 2, 100, null),
            position("SMLA", "B", 2, 100, null),
            position("SMLA", "C", 2, 100, null),
        ];
        const byAccount = splitSmallPositions(positions, 99_600);
        assert.equal(byAccount.small?.limit, 498);
        assert.deepEqual(byAccount.small?.rows.map((r) => r.account), ["A", "B", "C"]);
        assert.deepEqual(byAccount.small?.accounts.map((a) => a.name), ["A", "B", "C"]);
        // Together SMLA is worth $600: a row of its own, and nothing to group.
        const bySymbol = splitSmallPositions(combineBySymbol(positions), 99_600);
        assert.equal(bySymbol.small, null);
        assert.deepEqual(symbolsOf(bySymbol.shown), ["BIGX", "SMLA"]);
    });

    it("names each account once by ID, in name order: two accounts both called Brokerage are two", () => {
        const { small } = splitSmallPositions([
            row("BIGX", 100_000, { accountId: "p1", account: "Brokerage" }),
            row("SMLA", 10, { accountId: "p2", account: "Brokerage" }),
            // By symbol: one row across two accounts with the same name.
            row("SMLB", 20, { accountId: "p1", account: "Brokerage", accounts: ["Brokerage", "Brokerage"], accountIds: ["p1", "p2"] }),
            row("SMLC", 30, { accountId: "p3", account: "alpha IRA" }),
            row("SMLD", 40, { accountId: "p1", account: "Brokerage" }),
        ], 100_100);
        assert.deepEqual(small?.accounts, [
            { id: "p3", name: "alpha IRA" },
            { id: "p1", name: "Brokerage" },
            { id: "p2", name: "Brokerage" },
        ]);
    });
});

describe("holdings / smallPositionsLimitLabel", () => {
    it("says which limit makes the positions small", () => {
        assert.equal(smallPositionsLimitLabel("value"), "Each under $500");
        assert.equal(smallPositionsLimitLabel("share"), "Each under 0.5% of market value");
    });

    it("writes the limits from the rule given", () => {
        const rule = { maxValue: 1_000, maxShare: 0.0025, minCount: 4 };
        assert.deepEqual(smallPositionsLimits(rule), { value: "$1,000", share: "0.25%", minCount: "four" });
        assert.deepEqual(smallPositionsLimits(), { value: "$500", share: "0.5%", minCount: "three" });
        assert.equal(smallPositionsLimitLabel("share", rule), "Each under 0.25% of market value");
    });
});

describe("holdings / formatSmallPositionValue", () => {
    it("writes a small position's value to the cent", () => {
        assert.equal(formatSmallPositionValue(1.5), "$1.50");
        assert.equal(formatSmallPositionValue(23), "$23.00");
        assert.equal(formatSmallPositionValue(0), "$0.00");
        assert.equal(formatSmallPositionValue(1_234.567), "$1,234.57");
    });
});

describe("holdings / formatAllocationPct", () => {
    it("writes a tenth of a percent, or a hundredth under 1%", () => {
        assert.equal(formatAllocationPct(53.09), "53.1%");
        assert.equal(formatAllocationPct(100), "100.0%");
        assert.equal(formatAllocationPct(1), "1.0%");
        // Under 1%: a small position reads 0.47%, not the 0.5% it is under.
        assert.equal(formatAllocationPct(0.475), "0.47%");
        assert.equal(formatAllocationPct(0.0056), "0.01%");
        assert.equal(formatAllocationPct(0), "0.00%");
    });
});
