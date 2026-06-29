import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeRiskPolicyDashboard } from "./dashboard";

describe("computeRiskPolicyDashboard", () => {
    test("builds a multi-dimension dashboard with breached concentration and missing cash purpose", () => {
        const summary = computeRiskPolicyDashboard({
            holdings: [
                { id: "goog", symbol: "GOOG", marketValue: 900_000 },
                { id: "nvda", symbol: "NVDA", marketValue: 140_000 },
                { id: "tsm", symbol: "TSM", marketValue: 80_000 },
                { id: "fnma", symbol: "FNMA", marketValue: 70_000 },
                { id: "rivn-call", symbol: "RIVN", marketValue: 20_000, instrumentType: "LEAPS call option" },
            ],
            cashTotal: 200_000,
            trades: [
                { id: "t1", date: "2026-05-01", type: "buy", ticker: "NVDA", amount: -25_000 },
                { id: "t2", date: "2026-05-08", type: "sell", ticker: "NVDA", amount: 15_000 },
            ],
            asOf: new Date("2026-05-15T00:00:00.000Z"),
        });

        assert.strictEqual(summary.dimensions.length, 12);
        assert.strictEqual(summary.overallStatus, "breached");
        assert.strictEqual(summary.employerStockPlan.status, "breached");
        assert.ok(summary.employerStockPlan.sellToTargetUsd > 0);
        assert.ok(summary.stressTests.some((result) => result.scenarioId === "goog_40_down"));
        assert.ok(summary.stressTests.find((result) => result.scenarioId === "goog_40_down")!.totalImpactUsd < 0);
        assert.deepStrictEqual(summary.sellDisciplineTasks, []);

        const singleName = summary.dimensions.find((dimension) => dimension.id === "single_name_concentration");
        assert.ok(singleName);
        assert.strictEqual(singleName.status, "breached");
        assert.strictEqual(singleName.impactedSymbols[0], "GOOG");
        assert.ok(singleName.currentPct! > 60);
        assert.ok(singleName.overLimitUsd > 0);

        const employer = summary.dimensions.find((dimension) => dimension.id === "employer_stock_concentration");
        assert.ok(employer);
        assert.strictEqual(employer.status, "breached");
        assert.deepStrictEqual(employer.impactedSymbols, ["GOOG"]);

        const cash = summary.dimensions.find((dimension) => dimension.id === "cash_purpose_coverage");
        assert.ok(cash);
        assert.strictEqual(cash.status, "missing_data");
        assert.strictEqual(cash.currentValueUsd, 200_000);

        const churn = summary.dimensions.find((dimension) => dimension.id === "churn_activity");
        assert.ok(churn);
        assert.strictEqual(churn.status, "watch");
        assert.deepStrictEqual(churn.impactedSymbols, ["NVDA"]);

        assert.ok(summary.nextActions.length > 0);
        assert.ok(summary.nextActions.some((action) => action.href === "/portfolios/holdings"));
    });

    test("surfaces unknown holdings as missing policy metadata instead of safe exposure", () => {
        const summary = computeRiskPolicyDashboard({
            holdings: [
                { id: "core", symbol: "VTI", marketValue: 90_000 },
                { id: "unknown", symbol: "XYZ", marketValue: 10_000 },
            ],
            cashTotal: 0,
            trades: [],
        });

        const missing = summary.dimensions.find((dimension) => dimension.id === "missing_policy_metadata");
        assert.ok(missing);
        assert.strictEqual(missing.status, "missing_data");
        assert.strictEqual(missing.currentLabel, "1 holding");
        assert.strictEqual(missing.currentValueUsd, 10_000);
    });

    test("uses configured cash jobs to clear cash purpose missing data", () => {
        const summary = computeRiskPolicyDashboard({
            holdings: [
                { id: "core", symbol: "VTI", marketValue: 300_000 },
            ],
            cashTotal: 200_000,
            cashJobs: [
                { id: "cash-emergency", type: "emergency_fund", label: "Emergency fund", amount: 80_000 },
                { id: "cash-tax", type: "tax_reserve", label: "Tax reserve", amount: 20_000 },
                { id: "cash-deploy", type: "scheduled_deployment", label: "Scheduled deployment", amount: 100_000 },
            ],
        });

        const cash = summary.dimensions.find((dimension) => dimension.id === "cash_purpose_coverage");
        assert.ok(cash);
        assert.strictEqual(cash.status, "inside");
        assert.strictEqual(cash.currentLabel, "100% assigned");
        assert.match(cash.explanation, /Reserved: \$100,000/);
    });

    test("uses configured churn policy thresholds for repeated trading activity", () => {
        const summary = computeRiskPolicyDashboard({
            holdings: [
                { id: "core", symbol: "VTI", marketValue: 300_000 },
            ],
            trades: [
                { id: "t1", date: "2026-05-01", type: "buy", ticker: "NVDA", amount: -10_000 },
                { id: "t2", date: "2026-05-08", type: "sell", ticker: "NVDA", amount: 8_000 },
            ],
            asOf: new Date("2026-05-15T00:00:00.000Z"),
            options: {
                churnWindowDays: 30,
                churnWatchRepeatSymbols: 1,
                churnBreachRepeatSymbols: 1,
            },
        });

        const churn = summary.dimensions.find((dimension) => dimension.id === "churn_activity");
        assert.ok(churn);
        assert.strictEqual(churn.status, "breached");
        assert.deepStrictEqual(churn.impactedSymbols, ["NVDA"]);
    });

    test("includes option positions in the speculative policy dimension", () => {
        const summary = computeRiskPolicyDashboard({
            holdings: [
                { id: "core", symbol: "VTI", marketValue: 500_000 },
            ],
            optionPositions: [
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
            asOf: new Date("2026-05-15T00:00:00.000Z"),
        });

        const speculative = summary.dimensions.find((dimension) => dimension.id === "speculative_options_exposure");
        assert.ok(speculative);
        assert.strictEqual(speculative.status, "breached");
        assert.match(speculative.currentLabel ?? "", /premium/);
        assert.ok(speculative.impactedSymbols.includes("RIVN"));
        assert.match(speculative.nextAction, /RIVN/);
    });

    test("passes persisted sell-discipline rules into the dashboard summary", () => {
        const summary = computeRiskPolicyDashboard({
            holdings: [
                {
                    id: "aapl",
                    symbol: "AAPL",
                    quantity: 100,
                    avgCost: 100,
                    currentPrice: 225,
                    marketValue: 22_500,
                },
                { id: "core", symbol: "VTI", marketValue: 77_500 },
            ],
            sellDisciplineRules: [
                {
                    id: "sell-aapl-target",
                    type: "target_price",
                    label: "AAPL target trim",
                    action: "trim",
                    state: "active",
                    symbol: "AAPL",
                    targetPrice: 220,
                    noAdd: true,
                },
            ],
        });

        assert.strictEqual(summary.sellDisciplineTasks.length, 1);
        assert.strictEqual(summary.sellDisciplineTasks[0].ruleId, "sell-aapl-target");
        assert.strictEqual(summary.sellDisciplineTasks[0].noAdd, true);
    });

    test("passes persisted employer-stock de-risking plan into dashboard next actions", () => {
        const summary = computeRiskPolicyDashboard({
            holdings: [
                {
                    id: "goog",
                    symbol: "GOOG",
                    quantity: 5_000,
                    currentPrice: 180,
                    marketValue: 900_000,
                },
                { id: "core", symbol: "VTI", marketValue: 900_000 },
            ],
            employerStockPlan: {
                id: "goog-derisk-v1",
                label: "GOOG employer stock de-risking",
                symbols: ["GOOG", "GOOGL"],
                state: "active",
                targetAllocationPct: 25,
                intermediateTargetPct: 30,
                trimCadence: "monthly",
                trimMethod: "fixed_amount",
                trimAmountUsd: 50_000,
                trimPercentOfPosition: 5,
                defaultVestAction: "sell_all",
                plannedVestValueUsd: 0,
                nextActionDate: "2026-05-01",
                destination: "core_index",
                destinationLabel: "Broad core index",
                taxReservePct: 20,
            },
            asOf: new Date("2026-05-16T00:00:00.000Z"),
        });

        assert.equal(summary.employerStockPlan.status, "breached");
        assert.equal(summary.employerStockPlan.nextAction?.label, "GOOG trim due");
        assert.equal(summary.employerStockPlan.nextAction?.sellUsd, 50_000);
        assert.equal(summary.employerStockPlan.schedule[0].estimatedTaxReserveUsd, 10_000);
    });

    test("classifies theme and bucket dimensions against policy caps", () => {
        const summary = computeRiskPolicyDashboard({
            holdings: [
                { id: "nvda", symbol: "NVDA", marketValue: 60_000 },
                { id: "mu", symbol: "MU", marketValue: 30_000 },
                { id: "vti", symbol: "VTI", marketValue: 10_000 },
            ],
            themeCaps: {
                ai_infrastructure: 25,
                semiconductors: 30,
            },
            bucketPolicies: [
                { bucket: "core", targetPct: 70, minPct: 55, maxPct: 90 },
                { bucket: "active", targetPct: 15, maxPct: 40 },
                { bucket: "speculative", targetPct: 3, maxPct: 5 },
                { bucket: "special_situation", targetPct: 2, maxPct: 3 },
                { bucket: "cash_reserve", targetPct: 10, maxPct: 20 },
                { bucket: "unassigned", targetPct: 0, maxPct: 0 },
            ],
        });

        const ai = summary.dimensions.find((dimension) => dimension.id === "ai_infrastructure_exposure");
        assert.ok(ai);
        assert.strictEqual(ai.status, "breached");

        const active = summary.dimensions.find((dimension) => dimension.id === "speculative_options_exposure");
        assert.ok(active);
        assert.strictEqual(active.status, "inside");
    });
});
