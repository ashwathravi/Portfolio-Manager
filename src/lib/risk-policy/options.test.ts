import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    DEFAULT_OPTIONS_RISK_POLICY,
    computeOptionRiskLedger,
    evaluateOptionOrderPolicy,
    optionCurrentValue,
    optionPremiumAtRisk,
    type OptionRiskPosition,
} from "./options";

const AAPL_CALL: OptionRiskPosition = {
    id: "aapl-call",
    underlying: "AAPL",
    contractType: "call",
    strike: 250,
    expiry: "2027-01-15",
    quantity: 3,
    premiumPaid: 18.2,
    currentPremium: 14.5,
    underlyingPrice: 182.45,
    linkedThesisId: "thesis-aapl",
    whatMustBeTrueByExpiry: "Services and AI margin expansion must re-rate EPS.",
    plannedExitRule: "Exit at 50% premium loss or roll 90 days before expiry.",
};

describe("option value helpers", () => {
    test("calculates premium at risk and current value using contract multiplier", () => {
        assert.equal(optionPremiumAtRisk(AAPL_CALL), 5_460);
        assert.equal(optionCurrentValue(AAPL_CALL), 4_350);
    });
});

describe("computeOptionRiskLedger", () => {
    test("builds ledger rows with premium, notional, expiry, and portfolio percentages", () => {
        const ledger = computeOptionRiskLedger({
            positions: [AAPL_CALL],
            totalPortfolioValue: 500_000,
            liquidNetWorth: 750_000,
            asOf: "2026-05-15",
        });

        assert.equal(ledger.rows.length, 1);
        assert.equal(ledger.totalPremiumAtRisk, 5_460);
        assert.equal(ledger.totalCurrentValue, 4_350);
        assert.equal(ledger.totalNotionalEquivalent, 54_735);
        assert.equal(Number(ledger.totalPremiumPctOfPortfolio.toFixed(2)), 1.09);
        assert.equal(Number(ledger.totalPremiumPctOfLiquidNetWorth?.toFixed(2)), 0.73);
        assert.equal(ledger.rows[0].daysToExpiry, 245);
        assert.equal(ledger.rows[0].status, "watch");
    });

    test("flags missing thesis metadata and over-cap option size", () => {
        const ledger = computeOptionRiskLedger({
            positions: [
                {
                    id: "rivn-call",
                    underlying: "RIVN",
                    contractType: "call",
                    strike: 25,
                    expiry: "2027-01-16",
                    quantity: 30,
                    premiumPaid: 4.4,
                    currentPremium: 1.9,
                    underlyingPrice: 14.2,
                },
            ],
            totalPortfolioValue: 500_000,
            asOf: "2026-05-15",
        });

        assert.equal(ledger.status, "breached");
        assert.equal(ledger.rows[0].premiumAtRisk, 13_200);
        assert.equal(Number(ledger.rows[0].premiumPctOfPortfolio.toFixed(2)), 2.64);
        assert.ok(ledger.rows[0].issues.some((issue) => issue.code === "position_size_cap"));
        assert.ok(ledger.rows[0].issues.some((issue) => issue.code === "missing_thesis"));
    });

    test("detects expiry clusters and per-underlying concentration", () => {
        const ledger = computeOptionRiskLedger({
            positions: [
                {
                    ...AAPL_CALL,
                    id: "aapl-call-near",
                    expiry: "2026-06-15",
                    quantity: 5,
                },
                {
                    ...AAPL_CALL,
                    id: "aapl-call-near-2",
                    expiry: "2026-06-20",
                    quantity: 5,
                },
            ],
            totalPortfolioValue: 500_000,
            policy: {
                ...DEFAULT_OPTIONS_RISK_POLICY,
                maxUnderlyingPremiumPct: 3,
                expiryClusterMaxPremiumPct: 1,
            },
            asOf: "2026-05-15",
        });

        assert.equal(ledger.expiringPremiumAtRisk, 18_200);
        assert.equal(Number(ledger.expiringPremiumPctOfPortfolio.toFixed(2)), 3.64);
        assert.equal(ledger.underlyingExposures[0].status, "breached");
        assert.equal(ledger.status, "breached");
        assert.ok(ledger.actionPrompts.length > 0);
    });
});

describe("evaluateOptionOrderPolicy", () => {
    test("blocks option orders without thesis, max loss acknowledgement, and expiry rules", () => {
        const result = evaluateOptionOrderPolicy({
            isOption: true,
            underlying: "AAPL",
            contractType: "call",
            strike: 250,
            expiry: "2027-01-15",
            quantity: 3,
            premium: 18.2,
            side: "buy",
            totalPortfolioValue: 500_000,
            asOf: "2026-05-15",
        });

        assert.equal(result.blocksSubmit, true);
        assert.equal(result.status, "breached");
        assert.ok(result.checks.some((check) => check.code === "missing_thesis"));
        assert.ok(result.checks.some((check) => check.code === "max_loss_ack"));
        assert.ok(result.checks.some((check) => check.code === "expiry_truth"));
        assert.ok(result.checks.some((check) => check.code === "exit_rule"));
    });

    test("allows a fully documented option order inside caps", () => {
        const result = evaluateOptionOrderPolicy({
            isOption: true,
            underlying: "AAPL",
            contractType: "call",
            strike: 250,
            expiry: "2027-01-15",
            quantity: 1,
            premium: 10,
            side: "buy",
            totalPortfolioValue: 500_000,
            linkedThesisId: "thesis-aapl",
            maxLossAcknowledged: true,
            whatMustBeTrueByExpiry: "Services growth must accelerate.",
            plannedExitRule: "Exit at 50% premium loss.",
            asOf: "2026-05-15",
        });

        assert.equal(result.blocksSubmit, false);
        assert.equal(result.status, "inside");
        assert.equal(result.premiumAtRisk, 1_000);
        assert.equal(result.notionalEquivalent, 25_000);
    });

    test("blocks oversized option orders even with documentation", () => {
        const result = evaluateOptionOrderPolicy({
            isOption: true,
            underlying: "RIVN",
            contractType: "call",
            strike: 25,
            expiry: "2027-01-16",
            quantity: 50,
            premium: 5,
            side: "buy",
            totalPortfolioValue: 500_000,
            linkedThesisId: "thesis-rivn",
            maxLossAcknowledged: true,
            whatMustBeTrueByExpiry: "Deliveries inflect.",
            plannedExitRule: "Exit before 120 days to expiry.",
            asOf: "2026-05-15",
        });

        assert.equal(result.blocksSubmit, true);
        assert.equal(result.premiumAtRisk, 25_000);
        assert.ok(result.checks.some((check) => check.code === "position_size_cap"));
    });
});
