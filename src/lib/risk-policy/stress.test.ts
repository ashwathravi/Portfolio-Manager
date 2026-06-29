import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    buildCustomStressScenario,
    findStressScenario,
    runBuiltInStressScenarios,
    runStressScenario,
} from "./stress";

const HOLDINGS = [
    { symbol: "GOOG", name: "Alphabet", marketValue: 900_000 },
    { symbol: "NVDA", name: "NVIDIA", marketValue: 150_000 },
    { symbol: "TSM", name: "Taiwan Semi", marketValue: 80_000 },
    { symbol: "VTI", name: "Total market", marketValue: 300_000 },
    { symbol: "COIN", name: "Coinbase", marketValue: 30_000 },
];

describe("risk policy / stress scenarios", () => {
    test("runs built-in GOOG drawdown with dollar impact and contributors", () => {
        const result = runStressScenario({
            holdings: HOLDINGS,
            cashTotal: 200_000,
            scenario: findStressScenario("goog_40_down"),
        });

        assert.equal(result.label, "GOOG -40%");
        assert.equal(result.totalImpactUsd, -360_000);
        assert.ok(result.portfolioImpactPct < -20);
        assert.equal(result.contributors[0].symbol, "GOOG");
        assert.equal(result.contributors[0].effectiveShockPct, -40);
        assert.ok(result.policyBreaches.some((breach) => breach.label.includes("Single-name")));
    });

    test("applies theme shocks by fallback theme weights", () => {
        const result = runStressScenario({
            holdings: HOLDINGS,
            scenario: findStressScenario("ai_basket_30_down"),
        });

        const nvda = result.contributors.find((row) => row.symbol === "NVDA");
        const goog = result.contributors.find((row) => row.symbol === "GOOG");
        assert.ok(nvda);
        assert.ok(goog);
        assert.equal(nvda.effectiveShockPct, -13.5);
        assert.equal(goog.effectiveShockPct, -6);
        assert.ok(result.totalImpactUsd < 0);
    });

    test("supports custom ticker and theme scenarios", () => {
        const tickerResult = runStressScenario({
            holdings: HOLDINGS,
            scenario: buildCustomStressScenario({
                kind: "ticker",
                value: "NVDA",
                shockPct: -50,
                label: "NVDA custom",
            }),
        });
        assert.equal(tickerResult.totalImpactUsd, -75_000);

        const themeResult = runStressScenario({
            holdings: HOLDINGS,
            scenario: buildCustomStressScenario({
                kind: "theme",
                value: "semiconductors",
                shockPct: -20,
                label: "Semi custom",
            }),
        });
        assert.ok(themeResult.contributors.some((row) => row.symbol === "TSM"));
    });

    test("discloses unknown target matches and unknown theme metadata", () => {
        const result = runStressScenario({
            holdings: [
                { symbol: "XYZ", marketValue: 100_000 },
            ],
            scenario: buildCustomStressScenario({
                kind: "theme",
                value: "ai_infrastructure",
                shockPct: -30,
            }),
        });

        assert.equal(result.totalImpactUsd, 0);
        assert.ok(result.missingDataNotes.some((note) => note.includes("No holdings matched theme")));
        assert.ok(result.missingDataNotes.some((note) => note.includes("unknown theme metadata")));
    });

    test("returns every built-in scenario", () => {
        const results = runBuiltInStressScenarios({
            holdings: HOLDINGS,
            cashTotal: 200_000,
        });

        assert.ok(results.length >= 8);
        assert.ok(results.some((result) => result.scenarioId === "broad_market_20_tech_beta"));
        assert.ok(results.some((result) => result.scenarioId === "cash_deploy_now_vs_monthly"));
    });
});
