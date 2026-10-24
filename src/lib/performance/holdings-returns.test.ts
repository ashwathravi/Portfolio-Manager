import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { StoredClose } from "@/lib/portfolio/valuation-snapshots";
import { benchmarkSeries, closeOn, returnSeries, stepReturn, type AccountSnapshot } from "./holdings-returns";

function closes(entries: Record<string, Array<[string, number]>>): Map<string, StoredClose[]> {
    return new Map(Object.entries(entries).map(([symbol, bars]) => [symbol, bars.map(([date, close]) => ({ date, close }))]));
}

function snapshot(portfolioId: string, date: string, cash: number, positions: Record<string, number | null>): AccountSnapshot {
    const list = Object.entries(positions).map(([symbol, marketValue]) => ({ symbol, marketValue }));
    const holdings = list.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
    return { portfolioId, date, totalValue: holdings + cash, positions: list };
}

const near = (actual: number | null, expected: number) =>
    assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);

// Mon 19 – Fri 23 October 2026.
const MON = "2026-10-19";
const TUE = "2026-10-20";
const WED = "2026-10-21";
const THU = "2026-10-22";

const bars = closes({
    KO: [[MON, 60], [TUE, 66], [WED, 66], [THU, 59.4]],
    PG: [[MON, 150], [TUE, 150], [WED, 165], [THU, 165]],
    SPY: [[MON, 500], [TUE, 510], [WED, 515.1], [THU, 515.1]],
});

describe("closeOn", () => {
    test("takes the last close on or before the date, at most a week old", () => {
        const series = closes({ X: [["2026-10-09", 10], ["2026-10-16", 12]] }).get("X");
        assert.equal(closeOn(series, "2026-10-16"), 12);
        assert.equal(closeOn(series, "2026-10-19"), 12);
        assert.equal(closeOn(series, "2026-10-15"), 10);
        assert.equal(closeOn(series, "2026-10-24"), null); // 8 days old
        assert.equal(closeOn(series, "2026-10-08"), null);
        assert.equal(closeOn(undefined, MON), null);
    });
});

describe("stepReturn", () => {
    test("prices what was held at the first close by the second; cash earns nothing", () => {
        // 6,000 of KO up 10% and 1,000 cash: +600 on 7,000.
        const step = stepReturn([snapshot("a", MON, 1000, { KO: 6000 })], TUE, bars);
        near(step.stepReturn, 600 / 7000);
        assert.deepEqual(step.unpriced, []);
    });

    test("combines accounts by value", () => {
        const step = stepReturn([snapshot("a", MON, 1000, { KO: 6000 }), snapshot("b", MON, 0, { PG: 7500 })], TUE, bars);
        near(step.stepReturn, 600 / 14500);
    });

    test("a position without a close is counted as unchanged and listed", () => {
        const step = stepReturn([snapshot("a", MON, 0, { KO: 6000, XNEW: 4000 })], TUE, bars);
        near(step.stepReturn, 600 / 10000);
        assert.deepEqual(step.unpriced, ["XNEW"]);
    });

    test("nothing invested has no return", () => {
        assert.equal(stepReturn([snapshot("a", MON, 0, {})], TUE, bars).stepReturn, null);
    });
});

describe("returnSeries", () => {
    test("chains steps into a growth-of-100 index", () => {
        const series = returnSeries([
            snapshot("a", MON, 1000, { KO: 6000 }),
            snapshot("a", TUE, 1000, { KO: 6600 }),
            snapshot("a", WED, 1000, { KO: 6600 }),
            snapshot("a", THU, 1000, { KO: 5940 }),
        ], bars);
        assert.deepEqual(series.map((p) => p.date), [MON, TUE, WED, THU]);
        assert.deepEqual(series.map((p) => p.value), [7000, 7600, 7600, 6940]);
        assert.equal(series[0].stepReturn, null);
        assert.equal(series[0].index, 100);
        near(series[1].stepReturn, 600 / 7000);
        near(series[2].stepReturn, 0);
        near(series[3].stepReturn, -660 / 7600);
        near(series[3].index, 100 * 6940 / 7000);
    });

    test("money moving in or out isn't a return", () => {
        // A 5,000 deposit on Tuesday and a 2,000 withdrawal on Wednesday: the
        // value jumps, the return is only KO's moves.
        const series = returnSeries([
            snapshot("a", MON, 1000, { KO: 6000 }),
            snapshot("a", TUE, 6000, { KO: 6600 }),
            snapshot("a", WED, 4000, { KO: 6600 }),
        ], bars);
        near(series[1].stepReturn, 600 / 7000);
        near(series[2].stepReturn, 0);
        assert.deepEqual(series.map((p) => p.value), [7000, 12600, 10600]);
    });

    test("a transfer between the user's own accounts isn't a return for either or for both together", () => {
        // Wednesday: account a moves its 1,000 cash to b. Thursday: KO -10%.
        const snapshots = [
            snapshot("a", MON, 1000, { KO: 6000 }),
            snapshot("b", MON, 0, { PG: 7500 }),
            snapshot("a", TUE, 1000, { KO: 6600 }),
            snapshot("b", TUE, 0, { PG: 7500 }),
            snapshot("a", WED, 0, { KO: 6600 }),
            snapshot("b", WED, 1000, { PG: 8250 }),
            snapshot("a", THU, 0, { KO: 5940 }),
            snapshot("b", THU, 1000, { PG: 8250 }),
        ];
        const a = returnSeries(snapshots.filter((s) => s.portfolioId === "a"), bars);
        near(a[2].stepReturn, 0);
        near(a[3].stepReturn, -0.1); // all in KO after the transfer
        const b = returnSeries(snapshots.filter((s) => s.portfolioId === "b"), bars);
        near(b[2].stepReturn, 0.1);
        near(b[3].stepReturn, 0);
        const both = returnSeries(snapshots, bars);
        assert.deepEqual(both.map((p) => p.value), [14500, 15100, 15850, 15190]);
        near(both[1].stepReturn, 600 / 14500);
        near(both[2].stepReturn, 750 / 15100);
        near(both[3].stepReturn, -660 / 15850);
    });

    test("a split between snapshots isn't a loss: stored closes are split-adjusted", () => {
        // 2-for-1 on Tuesday: the stored history is adjusted, so Monday's
        // close is 50 and the snapshot's 100 shares at 100 are 10,000 either way.
        const adjusted = closes({ X: [[MON, 50], [TUE, 51]] });
        const series = returnSeries([
            snapshot("a", MON, 0, { X: 10000 }),
            snapshot("a", TUE, 0, { X: 10200 }),
        ], adjusted);
        near(series[1].stepReturn, 0.02);
    });

    test("an account added later joins from its first snapshot", () => {
        const series = returnSeries([
            snapshot("a", MON, 0, { KO: 6000 }),
            snapshot("a", TUE, 0, { KO: 6600 }),
            snapshot("b", TUE, 0, { PG: 7500 }),
            snapshot("a", WED, 0, { KO: 6600 }),
            snapshot("b", WED, 0, { PG: 8250 }),
        ], bars);
        near(series[1].stepReturn, 0.1);
        near(series[2].stepReturn, 750 / 14100);
    });

    test("a step with nothing invested keeps the index", () => {
        const series = returnSeries([
            snapshot("a", MON, 0, {}),
            snapshot("a", TUE, 0, { KO: 6600 }),
            snapshot("a", WED, 0, { KO: 6600 }),
        ], bars);
        assert.deepEqual(series.map((p) => [p.stepReturn, p.index]), [[null, 100], [null, 100], [0, 100]]);
    });

    test("steps over missed sessions measure buy-and-hold across the gap", () => {
        const series = returnSeries([
            snapshot("a", MON, 0, { KO: 6000 }),
            snapshot("a", THU, 0, { KO: 5940 }),
        ], bars);
        near(series[1].stepReturn, 59.4 / 60 - 1);
    });

    test("no snapshots, no points", () => {
        assert.deepEqual(returnSeries([], bars), []);
    });
});

describe("benchmarkSeries", () => {
    test("the benchmark's close on each date", () => {
        assert.deepEqual(benchmarkSeries([MON, WED], bars.get("SPY")), [{ date: MON, value: 500 }, { date: WED, value: 515.1 }]);
    });

    test("null when a date has no close", () => {
        assert.equal(benchmarkSeries(["2026-10-09", MON], bars.get("SPY")), null);
        assert.equal(benchmarkSeries([MON], undefined), null);
    });
});
