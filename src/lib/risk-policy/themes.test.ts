import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    computeThemeExposure,
    themeLabel,
    themeWeightsForSymbol,
    type ThemeExposureHolding,
} from "./themes";

describe("risk policy / theme exposure engine", () => {
    test("maps AI and semiconductor names to weighted fallback themes", () => {
        const nvda = themeWeightsForSymbol("NVDA");

        assert.deepStrictEqual(
            nvda.map((weight) => [weight.theme, weight.weight]),
            [
                ["ai_infrastructure", 0.45],
                ["semiconductors", 0.45],
                ["mega_cap_growth", 0.1],
            ],
        );
    });

    test("normalizes explicit multi-theme weights", () => {
        const weights = themeWeightsForSymbol("CUSTOM", [
            { theme: "ai_infrastructure", weight: 3 },
            { theme: "cloud_platforms", weight: 1 },
        ]);

        assert.equal(weights[0].weight, 0.75);
        assert.equal(weights[1].weight, 0.25);
    });

    test("surfaces unknown theme metadata instead of dropping holdings", () => {
        const weights = themeWeightsForSymbol("ZZZZ");

        assert.equal(weights.length, 1);
        assert.equal(weights[0].theme, "unknown");
        assert.equal(weights[0].source, "unknown");
    });

    test("computes weighted exposure, contributors, and bucket overlap", () => {
        const holdings: ThemeExposureHolding[] = [
            { id: "nvda", symbol: "NVDA", marketValue: 100_000 },
            { id: "goog", symbol: "GOOG", marketValue: 100_000 },
            { id: "vti", symbol: "VTI", marketValue: 100_000 },
        ];

        const exposure = computeThemeExposure(holdings);
        const ai = exposure.rows.find((row) => row.theme === "ai_infrastructure")!;
        const broad = exposure.rows.find((row) => row.theme === "broad_core_index")!;

        assert.equal(exposure.totalMarketValue, 300_000);
        assert.equal(ai.marketValue, 65_000);
        assert.equal(Number(ai.percentOfPortfolio.toFixed(2)), 21.67);
        assert.equal(ai.contributors[0].symbol, "NVDA");
        assert.equal(ai.bucketBreakdown[0].bucket, "active");
        assert.equal(broad.marketValue, 100_000);
        assert.equal(broad.bucketBreakdown[0].bucket, "core");
    });

    test("flags theme caps and unknown metadata states", () => {
        const exposure = computeThemeExposure([
            { symbol: "GOOG", marketValue: 900_000 },
            { symbol: "ZZZZ", marketValue: 100_000 },
        ]);
        const employer = exposure.rows.find((row) => row.theme === "employer_linked_wealth")!;
        const unknown = exposure.rows.find((row) => row.theme === "unknown")!;

        assert.equal(employer.percentOfPortfolio, 18);
        assert.equal(employer.status, "inside");
        assert.equal(unknown.status, "missing_data");
        assert.equal(exposure.unknownCount, 1);
    });

    test("exposes stable labels for UI chips", () => {
        assert.equal(themeLabel("ai_infrastructure"), "AI infrastructure");
        assert.equal(themeLabel("bonds_treasuries_cash_equivalent"), "Bonds/treasuries/cash equivalent");
    });
});
