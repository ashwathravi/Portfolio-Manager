import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    BUILT_IN_STRESS_SCENARIOS,
    buildCustomStressScenario,
    employerStressScenarios,
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
    test("runs the employer drawdown on the tickers the user named, with dollar impact and contributors", () => {
        const result = runStressScenario({
            holdings: HOLDINGS,
            cashTotal: 200_000,
            scenario: findStressScenario("employer_40_down", ["GOOG", "GOOGL"]),
        });

        assert.equal(result.label, "GOOG -40%");
        assert.match(result.assumption, /^GOOG\/GOOGL are shocked down 40%/);
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
        // Not named as the employer's: all of GOOG keeps the company's themes.
        assert.equal(goog.effectiveShockPct, -7.5);
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

    test("returns every built-in scenario, the employer's only for a user who named theirs", () => {
        const results = runBuiltInStressScenarios({
            holdings: HOLDINGS,
            cashTotal: 200_000,
        });

        assert.equal(results.length, BUILT_IN_STRESS_SCENARIOS.length);
        assert.ok(results.some((result) => result.scenarioId === "broad_market_20_tech_beta"));
        assert.ok(results.some((result) => result.scenarioId === "cash_deploy_now_vs_monthly"));
        assert.ok(!results.some((result) => result.scenarioId.startsWith("employer_")));

        const named = runBuiltInStressScenarios({ holdings: HOLDINGS, cashTotal: 200_000, employerSymbols: ["msft"] });
        assert.deepEqual(named.slice(0, 2).map((result) => result.scenarioId), ["employer_40_down", "employer_job_risk"]);
        assert.equal(named[0].label, "MSFT -40%");
        assert.equal(named[0].totalImpactUsd, 0);
    });

    test("regression: no employer scenario is assumed, and an unknown id falls back to the first", () => {
        assert.deepEqual(employerStressScenarios([]), []);
        assert.deepEqual(employerStressScenarios([" ", ""]), []);
        assert.equal(findStressScenario("employer_40_down").id, BUILT_IN_STRESS_SCENARIOS[0].id);
    });
});
