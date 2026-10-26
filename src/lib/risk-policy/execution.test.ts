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
            employerSymbols: ["GOOG", "GOOGL"],
            asOf: "2026-05-15",
        });

        const employer = result.failedChecks.find((check) => check.ruleType === "employer_stock_allocation");
        assert.ok(employer);
        assert.match(employer.message, /Employer-linked wealth/);
        assert.equal(employer.decision, "override_required");
    });

    test("regression: without employer tickers named, a GOOG add is not an employer-stock add", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: [{ symbol: "GOOG", marketValue: 450_000, policyBucket: "active" }],
            portfolioValue: 500_000,
            trade: { ticker: "GOOG", side: "buy", quantity: 100, price: 1_000, linkedThesisId: "seed-goog", thesisUpdatedAt: "2026-05-01" },
            themeCaps: { employer_linked_wealth: 15 },
            asOf: "2026-05-15",
        });

        assert.equal(result.checks.some((check) => check.ruleType === "employer_stock_allocation"), false);
    });

    test("regression: a ticker held in two accounts takes the trade once", () => {
        const holdings: PreTradeRiskPolicyHolding[] = [
            { symbol: "XYZ", marketValue: 20_000, policyBucket: "speculative" },
            { symbol: "XYZ", marketValue: 10_000, policyBucket: "speculative" },
            { symbol: "VTI", marketValue: 70_000, policyBucket: "core" },
        ];
        const bucketCheck = (side: "buy" | "sell") => evaluatePreTradeRiskPolicy({
            holdings,
            portfolioValue: 100_000,
            trade: { ticker: "XYZ", side, quantity: 50, price: 100, linkedThesisId: "t", thesisUpdatedAt: "2026-05-01" },
            asOf: "2026-05-15",
        }).checks.find((check) => check.ruleType === "bucket_allocation")!;

        const buy = bucketCheck("buy");
        assert.equal(buy.currentValue, 30_000);
        assert.equal(buy.postValue, 35_000);
        // A sale bigger than one account's position comes out of the next.
        const sell = evaluatePreTradeRiskPolicy({
            holdings,
            portfolioValue: 100_000,
            trade: { ticker: "XYZ", side: "sell", quantity: 250, price: 100 },
            asOf: "2026-05-15",
        }).checks.find((check) => check.ruleType === "bucket_allocation")!;
        assert.equal(sell.currentValue, 30_000);
        assert.equal(sell.postValue, 5_000);
        assert.equal(bucketCheck("sell").postValue, 25_000);
    });

    test("regression: holdings that couldn't be loaded need a reason, not a silent pass", () => {
        const input = {
            holdings: [],
            portfolioValue: 0,
            trade: { ticker: "NVDA", side: "buy" as const, quantity: 10, price: 500 },
            portfolioUnavailable: true,
            asOf: "2026-05-15",
        };
        const blocked = evaluatePreTradeRiskPolicy(input);
        assert.equal(blocked.decision, "override_required");
        assert.equal(blocked.requiresOverride, true);
        assert.equal(blocked.blocksSubmit, true);
        assert.equal(blocked.direction, "missing_data");
        assert.match(blocked.summary, /couldn't be loaded/);

        const overridden = evaluatePreTradeRiskPolicy({ ...input, overrideReason: "Checked my holdings by hand first." });
        assert.equal(overridden.blocksSubmit, false);
        assert.equal(overridden.overrideAccepted, true);

        // Loaded, but nothing held: nothing to check against.
        const empty = evaluatePreTradeRiskPolicy({ ...input, portfolioUnavailable: false });
        assert.equal(empty.blocksSubmit, false);
        assert.match(empty.summary, /Add holdings/);
    });

    test("regression: an option on a held stock is an option, not in the stock's bucket", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: [
                { symbol: "XYZ", marketValue: 60_000, policyBucket: "core" },
                { symbol: "VTI", marketValue: 40_000, policyBucket: "core" },
            ],
            portfolioValue: 100_000,
            trade: { ticker: "XYZ", side: "buy", quantity: 1, price: 5, instrumentType: "option", optionPremiumAtRisk: 500, linkedThesisId: "t", thesisUpdatedAt: "2026-05-01" },
            existingOptionPositions: [],
            asOf: "2026-05-15",
        });
        const bucket = result.checks.find((check) => check.ruleType === "bucket_allocation");
        assert.ok(bucket);
        assert.match(bucket.label, /Speculative/);
        assert.equal(result.checks.some((check) => /Core/.test(check.label)), false);
    });

    test("regression: a ticker sold out of is bought back into the bucket chosen for it", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: [{ symbol: "VTI", marketValue: 100_000, policyBucket: "core" }],
            portfolioValue: 100_000,
            trade: { ticker: "MSFT", side: "buy", quantity: 10, price: 400, policyBucket: "speculative", linkedThesisId: "t", thesisUpdatedAt: "2026-05-01" },
            asOf: "2026-05-15",
        });
        const bucket = result.checks.find((check) => check.ruleType === "bucket_allocation");
        assert.ok(bucket);
        assert.match(bucket.label, /Speculative/);
    });

    test("a buy of a held ticker goes in the bucket chosen for it", () => {
        const result = evaluatePreTradeRiskPolicy({
            holdings: [
                { symbol: "XYZ", marketValue: 20_000, policyBucket: "speculative" },
                { symbol: "VTI", marketValue: 80_000, defaultBucket: "core" },
            ],
            portfolioValue: 100_000,
            trade: { ticker: "XYZ", side: "buy", quantity: 10, price: 100, linkedThesisId: "t", thesisUpdatedAt: "2026-05-01" },
            asOf: "2026-05-15",
        });

        const bucket = result.checks.find((check) => check.ruleType === "bucket_allocation");
        assert.ok(bucket);
        assert.match(bucket.label, /Speculative/);
        assert.equal(result.checks.some((check) => check.ruleType === "missing_bucket_classification"), false);
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
