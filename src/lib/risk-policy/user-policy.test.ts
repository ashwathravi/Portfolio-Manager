import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_BUCKET_POLICIES } from "./buckets";
import { DEFAULT_CASH_DEPLOYMENT_RULE } from "./cash";
import { DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN } from "./de-risking";
import { DEFAULT_OPTIONS_RISK_POLICY } from "./options";
import { DEFAULT_SELL_DISCIPLINE_RULES } from "./sell-discipline";
import { DEFAULT_THEME_CAPS } from "./themes";
import {
    DEFAULT_CHURN_POLICY,
    EMPTY_POLICY_PORTFOLIO,
    MAX_BUCKET_ASSIGNMENTS,
    MAX_EMPLOYER_TICKERS,
    employerSymbols,
    evaluateRiskPolicy,
    parseEmployerTickers,
    policyHoldings,
    policyPortfolioValue,
    riskPolicyInput,
    withBucketChoice,
    type PolicyPortfolio,
    type RiskPolicySettings,
} from "./user-policy";

const POLICY: RiskPolicySettings = {
    bucketPolicies: [...DEFAULT_BUCKET_POLICIES],
    themeCaps: { ...DEFAULT_THEME_CAPS },
    cashJobs: [],
    cashDeploymentRule: { ...DEFAULT_CASH_DEPLOYMENT_RULE },
    employerStockPlan: { ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN, symbols: [] },
    optionsRiskPolicy: { ...DEFAULT_OPTIONS_RISK_POLICY },
    sellDisciplineRules: DEFAULT_SELL_DISCIPLINE_RULES.map((rule) => ({ ...rule })),
    churnPolicy: { ...DEFAULT_CHURN_POLICY },
    bucketAssignments: {},
};

const PORTFOLIO: PolicyPortfolio = {
    holdings: [
        { id: "h1", symbol: "MSFT", name: "Microsoft", quantity: 100, avgCost: 300, currentPrice: 400, marketValue: 40_000, defaultBucket: "active" },
        { id: "h2", symbol: "VTI", name: "Vanguard Total Stock Market ETF", quantity: 200, avgCost: 200, currentPrice: 250, marketValue: 50_000, defaultBucket: "core" },
        { id: "h3", symbol: "msft", name: "Microsoft", quantity: 25, avgCost: 350, currentPrice: 400, marketValue: 10_000, defaultBucket: "active" },
    ],
    cashTotal: 10_000,
    trades: [],
    theses: [],
};

describe("policyHoldings", () => {
    test("each holding in the bucket the user chose for its ticker, else none (its default stands)", () => {
        const rows = policyHoldings(PORTFOLIO.holdings, { ...POLICY, bucketAssignments: { MSFT: "speculative" } });
        assert.deepEqual(rows.map((row) => [row.symbol, row.policyBucket, row.defaultBucket]), [
            ["MSFT", "speculative", "active"],
            ["VTI", null, "core"],
            ["msft", "speculative", "active"],
        ]);
    });

    test("employer stock is the tickers the user named, and only those", () => {
        assert.deepEqual(policyHoldings(PORTFOLIO.holdings, POLICY).map((row) => row.isEmployerStock), [false, false, false]);
        const named = { ...POLICY, employerStockPlan: { ...POLICY.employerStockPlan, symbols: [" msft "] } };
        assert.deepEqual(policyHoldings(PORTFOLIO.holdings, named).map((row) => row.isEmployerStock), [true, false, true]);
        assert.deepEqual(employerSymbols(named), ["MSFT"]);
    });
});

describe("riskPolicyInput / evaluateRiskPolicy", () => {
    test("the user's policy, on their portfolio, with no example option positions", () => {
        const policy: RiskPolicySettings = {
            ...POLICY,
            themeCaps: { ...POLICY.themeCaps, cloud_platforms: 5 },
            churnPolicy: { windowDays: 30, watchRepeatSymbols: 2, breachRepeatSymbols: 4 },
        };
        const input = riskPolicyInput(PORTFOLIO, policy);
        assert.equal(input.cashTotal, 10_000);
        assert.deepEqual(input.optionPositions, []);
        assert.equal(input.themeCaps, policy.themeCaps);
        assert.deepEqual(input.options, { churnWindowDays: 30, churnWatchRepeatSymbols: 2, churnBreachRepeatSymbols: 4 });
    });

    test("the bucket choices and caps change the checks", () => {
        const before = evaluateRiskPolicy(PORTFOLIO, POLICY);
        const speculative = (summary: ReturnType<typeof evaluateRiskPolicy>) =>
            summary.dimensions.find((dimension) => dimension.id === "speculative_options_exposure")!;
        assert.equal(speculative(before).status, "inside");

        // $50,000 of $110,000 (cash included) chosen as speculative, against a 5% cap.
        const after = evaluateRiskPolicy(PORTFOLIO, { ...POLICY, bucketAssignments: { MSFT: "speculative" } });
        assert.equal(speculative(after).status, "breached");
        assert.equal(speculative(after).currentPct, (50_000 / 110_000) * 100);
        assert.ok(after.nextActions.some((action) => action.id === "speculative_options_exposure"));
    });

    test("an empty portfolio has nothing to measure", () => {
        const summary = evaluateRiskPolicy(EMPTY_POLICY_PORTFOLIO, POLICY);
        assert.equal(summary.totalMarketValue, 0);
        assert.deepEqual(summary.sellDisciplineTasks, []);
    });

    test("what the holdings and cash are worth together", () => {
        assert.equal(policyPortfolioValue(PORTFOLIO), 110_000);
        assert.equal(policyPortfolioValue(EMPTY_POLICY_PORTFOLIO), 0);
    });
});

describe("withBucketChoice", () => {
    test("sets a ticker's bucket, or takes it back to its default", () => {
        const chosen = withBucketChoice({ VTI: "core" }, "msft", "speculative", ["MSFT", "VTI"]);
        assert.deepEqual(chosen, { VTI: "core", MSFT: "speculative" });
        assert.deepEqual(withBucketChoice(chosen, "MSFT", null, ["MSFT", "VTI"]), { VTI: "core" });
    });

    test("past the limit, choices for tickers no longer held go first", () => {
        const full = Object.fromEntries(Array.from({ length: MAX_BUCKET_ASSIGNMENTS }, (_, i) => [`OLD${i}`, "core" as const]));
        const next = withBucketChoice(full, "NEW", "active", ["NEW", "OLD7"]);
        assert.deepEqual(next, { OLD7: "core", NEW: "active" });
        // At the limit exactly, nothing goes.
        const most = Object.fromEntries(Array.from({ length: MAX_BUCKET_ASSIGNMENTS - 1 }, (_, i) => [`OLD${i}`, "core" as const]));
        assert.equal(Object.keys(withBucketChoice(most, "NEW", "active", [])).length, MAX_BUCKET_ASSIGNMENTS);
    });
});

describe("parseEmployerTickers", () => {
    test("the tickers in what the user typed, upper case and each once", () => {
        assert.deepEqual(parseEmployerTickers("goog, googl"), ["GOOG", "GOOGL"]);
        assert.deepEqual(parseEmployerTickers("  BRK.B;brk.b  BRK.A\n"), ["BRK.B", "BRK.A"]);
        assert.deepEqual(parseEmployerTickers(""), []);
    });

    test("anything that isn't a ticker is left out, and there are at most a few", () => {
        assert.deepEqual(parseEmployerTickers("$$$, GOOG!, TOOLONGTICKER, -X, MSFT"), ["MSFT"]);
        assert.equal(parseEmployerTickers("A B C D E F G").length, MAX_EMPLOYER_TICKERS);
    });
});
