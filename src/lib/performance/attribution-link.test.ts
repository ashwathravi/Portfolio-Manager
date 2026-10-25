import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { computeAttribution } from "./attribution";
import { carinoFactor, linkAttribution, type AttributionStep } from "./attribution-link";

const near = (actual: number, expected: number, tolerance = 1e-9) =>
    assert.ok(Math.abs(actual - expected) < tolerance, `expected ${expected}, got ${actual}`);

const MON = "2026-10-19";
const TUE = "2026-10-20";
const WED = "2026-10-21";

describe("linkAttribution", () => {
    const weights: Record<string, number> = {
        technology: 0.5, communication: 0, consumer: 0.5, financials: 0, healthcare: 0, industrials: 0, energy: 0,
        materials: 0, "real-estate": 0, utilities: 0, other: 0, cash: 0,
    };
    const segment = (key: string, weight: number, ret: number) => ({ key, weight, return: ret });
    const step = (from: string, to: string, consumer: [number, number], tech: [number, number], cash: number, bench: Record<string, number>): AttributionStep => ({
        from,
        to,
        sector: [
            segment("technology", tech[0], tech[1]),
            segment("consumer", consumer[0], consumer[1]),
            segment("cash", cash, 0),
        ],
        assetClass: [segment("stock", tech[0] + consumer[0], 0), segment("cash", cash, 0)],
        benchmarkSectorReturns: bench,
    });

    test("one step is BHB as computed directly", () => {
        const one = step(MON, TUE, [0.6, 0.1], [0.3, -0.05], 0.1, { technology: 0.02, consumer: 0.04 });
        const linked = linkAttribution([one], "sector", weights);
        const direct = computeAttribution([
            { key: "technology", label: "Technology", portfolioWeight: 0.3, benchmarkWeight: 0.5, portfolioReturn: -0.05, benchmarkReturn: 0.02 },
            { key: "consumer", label: "Consumer", portfolioWeight: 0.6, benchmarkWeight: 0.5, portfolioReturn: 0.1, benchmarkReturn: 0.04 },
            { key: "cash", label: "Cash", portfolioWeight: 0.1, benchmarkWeight: 0, portfolioReturn: 0, benchmarkReturn: 0 },
        ]);
        near(linked.total.portfolioReturn, direct.total.portfolioReturn);
        near(linked.total.benchmarkReturn, direct.total.benchmarkReturn);
        for (const key of ["technology", "consumer", "cash"]) {
            const a = linked.segments.find((s) => s.key === key)!;
            const b = direct.segments.find((s) => s.key === key)!;
            near(a.allocationEffect, b.allocationEffect);
            near(a.selectionEffect, b.selectionEffect);
            near(a.interactionEffect, b.interactionEffect);
        }
    });

    test("over several steps the effects add up to the period's excess return", () => {
        const steps = [
            step(MON, TUE, [0.6, 0.1], [0.3, -0.05], 0.1, { technology: 0.02, consumer: 0.04 }),
            step(TUE, WED, [0.62, -0.03], [0.28, 0.06], 0.1, { technology: 0.03, consumer: -0.01 }),
        ];
        const linked = linkAttribution(steps, "sector", weights);
        const r1 = 0.6 * 0.1 + 0.3 * -0.05;
        const r2 = 0.62 * -0.03 + 0.28 * 0.06;
        near(linked.total.portfolioReturn, (1 + r1) * (1 + r2) - 1);
        near(linked.total.benchmarkReturn, (1 + 0.03) * (1 + 0.01) - 1);
        near(linked.total.totalEffect, linked.total.alpha);
        near(linked.segments.reduce((s, x) => s + x.contribution, 0), linked.total.portfolioReturn);
        const tech = linked.segments.find((s) => s.key === "technology")!;
        near(tech.portfolioWeight, 0.29);
        near(tech.portfolioReturn, 0.95 * 1.06 - 1);
        near(tech.benchmarkReturn, 1.02 * 1.03 - 1);
    });

    test("holding cash costs the benchmark's return, as allocation", () => {
        const allCash = step(MON, TUE, [0, 0], [0, 0], 1, { technology: 0.02, consumer: 0.04 });
        const linked = linkAttribution([allCash], "sector", weights);
        near(linked.total.alpha, -0.03);
        near(linked.segments.find((s) => s.key === "cash")!.allocationEffect, -0.03);
    });

    test("steps without a benchmark are left out", () => {
        const steps = [step(MON, TUE, [0.6, 0.1], [0.3, -0.05], 0.1, { technology: 0.02, consumer: 0.04 }), { ...step(TUE, WED, [0.6, 0.5], [0.3, 0], 0.1, {}), benchmarkSectorReturns: null }];
        near(linkAttribution(steps, "sector", weights).total.portfolioReturn, 0.6 * 0.1 + 0.3 * -0.05);
    });

    test("against the S&P on asset class, stocks are the benchmark and cash is a drag", () => {
        const one = step(MON, TUE, [0.6, 0.1], [0.3, -0.05], 0.1, { technology: 0.02, consumer: 0.04 });
        const linked = linkAttribution([one], "assetClass", weights);
        near(linked.total.benchmarkReturn, 0.03);
        assert.equal(linked.segments.find((s) => s.key === "stock")!.benchmarkWeight, 1);
        near(linked.segments.find((s) => s.key === "cash")!.allocationEffect, 0.1 * (0 - 0.03));
    });
});

describe("carinoFactor", () => {
    test("its limit when the returns are equal", () => {
        near(carinoFactor(0.05, 0.05), 1 / 1.05);
        near(carinoFactor(0.05, 0.02), (Math.log(1.05) - Math.log(1.02)) / 0.03);
    });
});
