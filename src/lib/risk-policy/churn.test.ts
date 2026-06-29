import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { computeChurnAnalysis } from "./churn";

describe("risk policy / churn analyzer", () => {
    test("detects repeated buy/sell loops and ranks by score", () => {
        const analysis = computeChurnAnalysis([
            { id: "1", date: "2026-05-01", type: "buy", ticker: "NVDA", amount: -20_000 },
            { id: "2", date: "2026-05-03", type: "sell", ticker: "NVDA", amount: 18_000 },
            { id: "3", date: "2026-05-05", type: "buy", ticker: "NVDA", amount: -22_000 },
            { id: "4", date: "2026-05-04", type: "buy", ticker: "AAPL", amount: -5_000 },
        ], {
            asOf: "2026-05-10",
            windowDays: 30,
            breachRepeatSymbols: 2,
        });

        assert.equal(analysis.status, "breached");
        assert.equal(analysis.repeatSymbolCount, 1);
        assert.deepEqual(analysis.repeatSymbols, ["NVDA"]);
        assert.equal(analysis.rows[0].symbol, "NVDA");
        assert.ok(analysis.rows[0].flags.includes("repeated_loop"));
        assert.ok(analysis.rows[0].flags.includes("reopened_quickly"));
        assert.match(analysis.rows[0].recommendation, /Cooldown NVDA/);
    });

    test("distinguishes rebalance-labeled activity from uncontrolled churn", () => {
        const analysis = computeChurnAnalysis([
            {
                date: "2026-05-01",
                type: "buy",
                ticker: "VTI",
                amount: -20_000,
                setupType: "rebalance",
                notes: "Rebalance into core",
            },
            {
                date: "2026-05-03",
                type: "sell",
                ticker: "VTI",
                amount: 10_000,
                setupType: "rebalance",
                notes: "Rebalance cash sleeve",
            },
        ], {
            asOf: "2026-05-10",
            windowDays: 30,
        });

        assert.equal(analysis.rows[0].symbol, "VTI");
        assert.ok(analysis.rows[0].flags.includes("rebalance_labeled"));
        assert.ok(analysis.rows[0].churnScore < 35);
        assert.match(analysis.rows[0].recommendation, /inside/);
    });

    test("flags caution moods, low adherence, missing thesis adds, and short holding periods", () => {
        const analysis = computeChurnAnalysis([
            {
                date: "2026-05-01",
                type: "buy",
                ticker: "COIN",
                amount: -12_000,
                mood: "fomo",
                adherenceScore: 55,
                holdingPeriodDays: 3,
            },
            {
                date: "2026-05-04",
                type: "sell",
                ticker: "COIN",
                amount: 9_000,
                policyExceptions: [{ ruleType: "theme_factor_allocation" }],
            },
        ], {
            asOf: "2026-05-10",
            windowDays: 30,
        });

        const coin = analysis.rows[0];
        assert.equal(coin.status, "breached");
        assert.ok(coin.flags.includes("missing_thesis_add"));
        assert.ok(coin.flags.includes("caution_mood"));
        assert.ok(coin.flags.includes("low_adherence"));
        assert.ok(coin.flags.includes("short_holding_period"));
        assert.ok(coin.flags.includes("worsened_policy_breach"));
    });

    test("builds bucket and theme turnover rows when metadata is available", () => {
        const analysis = computeChurnAnalysis([
            {
                date: "2026-05-01",
                type: "buy",
                ticker: "NVDA",
                amount: -20_000,
                policyBucket: "active",
                theme: "ai_infrastructure",
            },
            {
                date: "2026-05-02",
                type: "sell",
                ticker: "NVDA",
                amount: 10_000,
                policyBucket: "active",
                theme: "ai_infrastructure",
            },
        ], {
            asOf: "2026-05-10",
        });

        assert.equal(analysis.bucketRows[0].key, "active");
        assert.equal(analysis.bucketRows[0].turnoverUsd, 30_000);
        assert.equal(analysis.themeRows[0].key, "ai_infrastructure");
        assert.deepEqual(analysis.themeRows[0].symbols, ["NVDA"]);
    });

    test("returns missing data when no buy/sell trade history is present", () => {
        const analysis = computeChurnAnalysis([
            { date: "2026-05-01", type: "dividend", ticker: "AAPL", amount: 100 },
        ]);

        assert.equal(analysis.status, "missing_data");
        assert.deepEqual(analysis.rows, []);
    });
});
