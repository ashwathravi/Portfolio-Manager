import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { StoredClose } from "@/lib/portfolio/valuation-snapshots";
import {
    benchmarkSectorReturns,
    estimateBenchmarkWeights,
    MIN_STYLE_RETURNS,
    projectToSimplex,
    SECTOR_ETFS,
    stepSegments,
    styleWeights,
    symbolSegments,
} from "./attribution-history";

const near = (actual: number, expected: number, tolerance = 1e-9) =>
    assert.ok(Math.abs(actual - expected) < tolerance, `expected ${expected}, got ${actual}`);

/** Weekday dates from `start`, `count` of them. */
function sessions(start: string, count: number): string[] {
    const out: string[] = [];
    const at = new Date(`${start}T12:00:00Z`);
    while (out.length < count) {
        if (at.getUTCDay() !== 0 && at.getUTCDay() !== 6) out.push(at.toISOString().slice(0, 10));
        at.setUTCDate(at.getUTCDate() + 1);
    }
    return out;
}

/** A deterministic, wiggly daily return for factor `i` on day `t`. */
const wiggle = (i: number, t: number) => 0.01 * Math.sin(1.7 * t + 0.9 * i) + 0.004 * Math.cos(0.6 * t * (i + 1));

describe("projectToSimplex", () => {
    test("non-negative, summing to 1; a point already on it stays", () => {
        const p = projectToSimplex([0.9, 0.5, -0.3]);
        near(p.reduce((s, x) => s + x, 0), 1);
        assert.ok(p.every((x) => x >= 0));
        const on = projectToSimplex([0.2, 0.3, 0.5]);
        on.forEach((x, i) => near(x, [0.2, 0.3, 0.5][i]));
    });
});

describe("styleWeights", () => {
    test("recovers the weights that made the target", () => {
        const truth = [0.5, 0.3, 0.2, 0];
        const factors = Array.from({ length: 120 }, (_, t) => truth.map((_, i) => wiggle(i, t)));
        const target = factors.map((row) => row.reduce((s, x, i) => s + x * truth[i], 0));
        const w = styleWeights(target, factors);
        w.forEach((x, i) => near(x, truth[i], 1e-3));
    });
});

/** Closes for SPY and the sector ETFs on `dates`, SPY moving as `weights` of the ETFs. */
function benchmarkCloses(dates: readonly string[], weights: Record<string, number>): Map<string, StoredClose[]> {
    const closes = new Map<string, StoredClose[]>();
    const level = new Map<string, number>([["SPY", 500], ...SECTOR_ETFS.map((e) => [e, 100] as [string, number])]);
    dates.forEach((date, t) => {
        if (t > 0) {
            let spy = 0;
            SECTOR_ETFS.forEach((etf, i) => {
                const r = wiggle(i, t);
                level.set(etf, level.get(etf)! * (1 + r));
                spy += (weights[etf] ?? 0) * r;
            });
            level.set("SPY", level.get("SPY")! * (1 + spy));
        }
        for (const [symbol, close] of level) {
            const list = closes.get(symbol) ?? [];
            list.push({ date, close });
            closes.set(symbol, list);
        }
    });
    return closes;
}

const SP_WEIGHTS: Record<string, number> = {
    XLK: 0.32, XLC: 0.1, XLY: 0.1, XLP: 0.06, XLF: 0.13, XLV: 0.1, XLI: 0.08, XLE: 0.03, XLB: 0.02, XLRE: 0.02, XLU: 0.04,
};

describe("estimateBenchmarkWeights", () => {
    test("the sector weights SPY moved with, consumer summing its two ETFs", () => {
        const dates = sessions("2026-01-05", 150);
        const estimate = estimateBenchmarkWeights(dates, benchmarkCloses(dates, SP_WEIGHTS));
        assert.ok(estimate);
        near(estimate.segments.technology, 0.32, 2e-3);
        near(estimate.segments.consumer, 0.16, 2e-3);
        near(estimate.etfs.XLP, 0.06, 2e-3);
        near(Object.values(estimate.segments).reduce((s, x) => s + x, 0), 1, 1e-9);
        assert.equal(estimate.segments.other, 0);
        assert.equal(estimate.returns, 149);
    });

    test("too few returns: no estimate", () => {
        const dates = sessions("2026-01-05", MIN_STYLE_RETURNS);
        assert.equal(estimateBenchmarkWeights(dates, benchmarkCloses(dates, SP_WEIGHTS)), null);
        const missing = benchmarkCloses(sessions("2026-01-05", 150), SP_WEIGHTS);
        missing.delete("XLRE");
        assert.equal(estimateBenchmarkWeights(sessions("2026-01-05", 150), missing), null);
    });
});

const MON = "2026-10-19";
const TUE = "2026-10-20";

function closes(entries: Record<string, Array<[string, number]>>): Map<string, StoredClose[]> {
    return new Map(Object.entries(entries).map(([symbol, bars]) => [symbol, bars.map(([date, close]) => ({ date, close }))]));
}

const SEGMENTS_OF: Record<string, ReturnType<typeof symbolSegments>> = {
    KO: { sector: "consumer", assetClass: "stock" },
    MSFT: { sector: "technology", assetClass: "stock" },
    BND: { sector: "other", assetClass: "fund" },
};
const segmentsOf = (symbol: string) => SEGMENTS_OF[symbol] ?? { sector: "other", assetClass: "other" };

describe("symbolSegments", () => {
    test("the stored sector and type, or the fallback sector", () => {
        assert.deepEqual(symbolSegments({ sector: "Tech", type: "CS" }, "Other"), { sector: "technology", assetClass: "stock" });
        assert.deepEqual(symbolSegments({ sector: "Auto", type: "CS" }, "Other"), { sector: "consumer", assetClass: "stock" });
        assert.deepEqual(symbolSegments({ sector: "Bonds", type: "ETF" }, "Other"), { sector: "other", assetClass: "fund" });
        assert.deepEqual(symbolSegments(undefined, "Finance"), { sector: "financials", assetClass: "other" });
    });
});

describe("stepSegments", () => {
    const bars = closes({ KO: [[MON, 60], [TUE, 66]], MSFT: [[MON, 400], [TUE, 380]] });

    test("weights are shares of the accounts' value, cash included; returns are the positions'", () => {
        const step = stepSegments([{ date: MON, totalValue: 10_000, positions: [{ symbol: "KO", marketValue: 6000 }, { symbol: "MSFT", marketValue: 2000 }] }], TUE, bars, segmentsOf);
        assert.ok(step);
        const sector = Object.fromEntries(step.sector.map((s) => [s.key, s]));
        near(sector.consumer.weight, 0.6);
        near(sector.consumer.return, 0.1);
        near(sector.technology.weight, 0.2);
        near(sector.technology.return, -0.05);
        near(sector.cash.weight, 0.2);
        assert.equal(sector.cash.return, 0);
        near(step.sector.reduce((s, x) => s + x.weight, 0), 1);
        // The portfolio's step return is the Returns page's: 600 − 100 on 10,000.
        near(step.sector.reduce((s, x) => s + x.weight * x.return, 0), 0.05);
        const asset = Object.fromEntries(step.assetClass.map((s) => [s.key, s]));
        near(asset.stock.weight, 0.8);
        near(asset.stock.return, 0.0625);
    });

    test("a position without a close counts as unchanged; one without a value is in nothing", () => {
        const step = stepSegments([{ date: MON, totalValue: 8000, positions: [{ symbol: "KO", marketValue: 6000 }, { symbol: "BND", marketValue: 2000 }, { symbol: "XNEW", marketValue: null }] }], TUE, bars, segmentsOf);
        const sector = Object.fromEntries(step!.sector.map((s) => [s.key, s]));
        near(sector.other.weight, 0.25);
        assert.equal(sector.other.return, 0);
        near(sector.cash.weight, 0);
    });

    test("nothing invested: no step", () => {
        assert.equal(stepSegments([{ date: MON, totalValue: 0, positions: [] }], TUE, bars, segmentsOf), null);
    });
});

describe("benchmarkSectorReturns", () => {
    const all = (from: number, to: number) =>
        closes(Object.fromEntries(SECTOR_ETFS.map((etf) => [etf, [[MON, from], [TUE, to]] as Array<[string, number]>])));

    test("each sector's ETF; consumer blends its two by weight", () => {
        const bars = all(100, 110);
        bars.set("XLP", [{ date: MON, close: 100 }, { date: TUE, close: 100 }]);
        const returns = benchmarkSectorReturns(MON, TUE, bars, { XLY: 0.1, XLP: 0.3 });
        assert.ok(returns);
        near(returns.technology, 0.1);
        near(returns.consumer, 0.025); // 0.1 × 10% + 0.3 × 0%, over 0.4
        assert.equal("other" in returns, false);
    });

    test("an ETF without a close: no benchmark for the step", () => {
        const bars = all(100, 110);
        bars.delete("XLU");
        assert.equal(benchmarkSectorReturns(MON, TUE, bars), null);
    });
});
