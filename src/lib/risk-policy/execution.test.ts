import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    buildRiskPolicyExceptions,
    evaluatePreTradeRiskPolicy,
    type PreTradeRiskPolicyHolding,
} from "./execution";

const HOLDINGS: PreTradeRiskPolicyHolding[] = [
    { id: "goog", symbol: "GOOG", name: "Alphabet", marketValue: 320_000, policyBucket: "active" },
    { id: "nvda", symbol: "NVDA", name: "NVIDIA", marketValue: 120_000, policyBucket: "active" },
    { id: "vti", symbol: "VTI", name: "Total market", marketValue: 60_000, policyBucket: "core" },
];

describe("pre-trade risk policy evaluator", () => {
    test("requires an override when a buy worsens a breached active bucket", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: HOLDINGS,
            portfolioValue: 500_000,
            trade: {
                ticker: "NVDA",
                side: "buy",
                quantity: 10,
                price: 500,
                linkedThesisId: "seed-nvda",
                thesisUpdatedAt: "2026-05-01",
            },
            asOf: "2026-05-15",
        });

        const bucket = result.failedChecks.find((check) => check.ruleType === "bucket_allocation");
        assert.equal(result.decision, "override_required");
        assert.equal(result.blocksSubmit, true);
        assert.ok(bucket);
        assert.equal(bucket.direction, "risk_increasing");
        assert.equal(bucket.thresholdPct, 20);
        assert.ok(bucket.postPct > bucket.currentPct);
    });

    test("permits a trim that reduces an existing breach", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: HOLDINGS,
            portfolioValue: 500_000,
            trade: {
                ticker: "NVDA",
                side: "sell",
                quantity: 10,
                price: 500,
            },
            asOf: "2026-05-15",
        });

        assert.equal(result.decision, "allowed");
        assert.equal(result.blocksSubmit, false);
        assert.equal(result.direction, "risk_reducing");
        assert.ok(result.checks.some((check) => check.direction === "risk_reducing"));
    });

    test("reports single-position breaches with the single-position rule type", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: HOLDINGS,
            portfolioValue: 500_000,
            trade: {
                ticker: "NVDA",
                side: "buy",
                quantity: 20,
                price: 500,
                linkedThesisId: "seed-nvda",
                thesisUpdatedAt: "2026-05-01",
            },
            bucketPolicies: [{ bucket: "active", maxPct: 95 }],
            asOf: "2026-05-15",
        });

        const singlePosition = result.failedChecks.find((check) => check.ruleType === "single_position_allocation");
        assert.ok(singlePosition);
        assert.equal(singlePosition.label, "Single-position cap");
        assert.equal(singlePosition.thresholdPct, 25);
    });

    test("flags employer-linked wealth adds when the employer theme breaches", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: [{ symbol: "GOOG", marketValue: 450_000, policyBucket: "active" }],
            portfolioValue: 500_000,
            trade: {
                ticker: "GOOG",
                side: "buy",
                quantity: 100,
                price: 1_000,
                linkedThesisId: "seed-goog",
                thesisUpdatedAt: "2026-05-01",
            },
            themeCaps: { employer_linked_wealth: 15 },
            asOf: "2026-05-15",
        });

        const employer = result.failedChecks.find((check) => check.ruleType === "employer_stock_allocation");
        assert.ok(employer);
        assert.match(employer.message, /Employer-linked wealth/);
        assert.equal(employer.decision, "override_required");
    });

    test("flags theme/factor cap adds independently from bucket caps", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: [{ symbol: "NVDA", marketValue: 180_000, policyBucket: "core" }],
            portfolioValue: 500_000,
            trade: {
                ticker: "TSM",
                side: "buy",
                quantity: 100,
                price: 500,
                policyBucket: "core",
                linkedThesisId: "seed-tsm",
                thesisUpdatedAt: "2026-05-01",
            },
            themeCaps: { semiconductors: 18 },
            bucketPolicies: [{ bucket: "core", maxPct: 90 }],
            asOf: "2026-05-15",
        });

        const theme = result.failedChecks.find((check) => check.ruleType === "theme_factor_allocation");
        assert.ok(theme);
        assert.match(theme.label, /Semiconductors/);
        assert.ok(theme.postPct > theme.thresholdPct);
    });

    test("flags total options premium budget for option adds", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: HOLDINGS,
            portfolioValue: 500_000,
            trade: {
                ticker: "AAPL",
                side: "buy",
                quantity: 50,
                price: 5,
                instrumentType: "option",
                optionPremiumAtRisk: 25_000,
                linkedThesisId: "seed-aapl",
                thesisUpdatedAt: "2026-05-01",
            },
            existingOptionPositions: [],
            optionsRiskPolicy: { maxTotalPremiumPct: 4 },
            asOf: "2026-05-15",
        });

        const options = result.failedChecks.find((check) => check.ruleType === "options_speculative_allocation");
        assert.ok(options);
        assert.equal(options.currentPct, 0);
        assert.equal(options.postPct, 5);
    });

    test("flags special situation adds against the special-situation cap", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: [{ symbol: "FNMA", marketValue: 18_000, policyBucket: "special_situation" }],
            portfolioValue: 500_000,
            trade: {
                ticker: "FMCC",
                side: "buy",
                quantity: 400,
                price: 10,
                linkedThesisId: "seed-fmcc",
                thesisUpdatedAt: "2026-05-01",
            },
            asOf: "2026-05-15",
        });

        const special = result.failedChecks.find((check) => check.ruleType === "special_situation_allocation");
        assert.ok(special);
        assert.equal(special.thresholdPct, 3);
        assert.ok(special.postPct > special.thresholdPct);
    });

    test("flags missing bucket classification for unknown buys", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: HOLDINGS,
            portfolioValue: 500_000,
            trade: {
                ticker: "ZZZZ",
                side: "buy",
                quantity: 10,
                price: 100,
                linkedThesisId: "seed-zzzz",
                thesisUpdatedAt: "2026-05-01",
            },
            asOf: "2026-05-15",
        });

        const missing = result.failedChecks.find((check) => check.ruleType === "missing_bucket_classification");
        assert.ok(missing);
        assert.equal(missing.status, "missing_data");
    });

    test("flags stale thesis adds and accepts a captured override reason", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: HOLDINGS,
            portfolioValue: 500_000,
            overrideReason: "Thesis was reviewed offline before this add.",
            trade: {
                ticker: "NVDA",
                side: "buy",
                quantity: 2,
                price: 500,
                linkedThesisId: "seed-nvda",
                thesisUpdatedAt: "2025-01-01",
            },
            asOf: "2026-05-15",
        });

        const stale = result.failedChecks.find((check) => check.ruleType === "stale_thesis");
        assert.ok(stale);
        assert.equal(result.blocksSubmit, false);
        assert.equal(result.exceptionPreview.some((exception) => exception.ruleType === "stale_thesis"), true);
    });

    test("buildRiskPolicyExceptions ignores too-short override reasons", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: HOLDINGS,
            portfolioValue: 500_000,
            trade: {
                ticker: "NVDA",
                side: "buy",
                quantity: 10,
                price: 500,
            },
            asOf: "2026-05-15",
        });

        assert.equal(buildRiskPolicyExceptions(result.failedChecks, "NVDA", "short").length, 0);
        assert.ok(buildRiskPolicyExceptions(result.failedChecks, "NVDA", "Documented exception for test.").length > 0);
    });
});
