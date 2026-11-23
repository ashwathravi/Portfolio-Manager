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
    HAND_VALUED_LABEL,
    MAX_BUCKET_ASSIGNMENTS,
    MAX_EMPLOYER_TICKERS,
    bucketChoiceKey,
    chosenBucket,
    chosenBucketForTrade,
    employerSymbols,
    evaluateRiskPolicy,
    handValuedNames,
    parseEmployerTickers,
    policyHoldingLabel,
    policyHoldings,
    policyPortfolioValue,
    riskPolicyInput,
    withBucketChoice,
    type AssignablePolicyBucket,
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
    options: [],
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

describe("holdings valued by hand", () => {
    const FUND = { id: "m1", symbol: "manual:m1", name: "Target 2055 Trust", quantity: 1, avgCost: 80_000, currentPrice: 90_000, marketValue: 90_000, defaultBucket: "core" as const };
    const ONE_STOCK: PolicyPortfolio = {
        holdings: [{ id: "h1", symbol: "ACME", name: "Acme", quantity: 100, avgCost: 50, currentPrice: 100, marketValue: 10_000, defaultBucket: "active" }],
        handValued: [FUND],
        cashTotal: 0,
        trades: [],
        theses: [],
        options: [],
    };

    test("regression: count in the portfolio's value, so one stock beside a big fund isn't all of it", () => {
        // Codex on PR #216: $10k of employer stock beside a $90k fund with no
        // ticker was checked as 100% of the portfolio.
        assert.equal(policyPortfolioValue(ONE_STOCK), 100_000);
        const summary = evaluateRiskPolicy(ONE_STOCK, POLICY);
        const single = summary.dimensions.find((d) => d.id === "single_name_concentration")!;
        assert.ok(Math.abs((single.currentPct ?? Number.NaN) - 10) < 1e-9, `got ${single.currentPct}`);
    });

    test("are core and broad, never a single name, and leave no policy metadata missing", () => {
        const input = riskPolicyInput({ ...ONE_STOCK, holdings: [] }, POLICY);
        assert.deepEqual(input.holdings, []);
        assert.deepEqual(input.otherHoldings?.map((h) => [h.symbol, h.policyBucket, h.themeWeights?.[0]?.theme]), [["manual:m1", "core", "broad_core_index"]]);
        const summary = evaluateRiskPolicy({ ...ONE_STOCK, holdings: [] }, POLICY);
        assert.equal(summary.dimensions.find((d) => d.id === "single_name_concentration")!.currentPct, 0);
        assert.equal(summary.dimensions.find((d) => d.id === "missing_policy_metadata")!.status, "inside");
    });

    const choosing = (bucket: AssignablePolicyBucket): RiskPolicySettings => ({ ...POLICY, bucketAssignments: { "manual:m1": bucket } });
    const check = (summary: ReturnType<typeof evaluateRiskPolicy>, id: string) => summary.dimensions.find((d) => d.id === id)!;

    test("are in the bucket chosen for them, core until then, and their theme follows it", () => {
        const fund = (policy: RiskPolicySettings) => {
            const [holding] = riskPolicyInput(ONE_STOCK, policy).otherHoldings ?? [];
            return [holding.symbol, holding.policyBucket, holding.themeWeights?.map((weight) => weight.theme), holding.isEmployerStock];
        };
        assert.deepEqual(fund(POLICY), ["manual:m1", "core", ["broad_core_index"], false]);
        assert.deepEqual(fund(choosing("core")), ["manual:m1", "core", ["broad_core_index"], false]);
        assert.deepEqual(fund(choosing("cash_reserve")), ["manual:m1", "cash_reserve", ["bonds_treasuries_cash_equivalent"], false]);
        assert.deepEqual(fund(choosing("special_situation")), ["manual:m1", "special_situation", ["special_situation_regulatory"], false]);
        assert.deepEqual(fund(choosing("active")), ["manual:m1", "active", ["unknown"], false]);
        assert.deepEqual(fund(choosing("speculative")), ["manual:m1", "speculative", ["unknown"], false]);
        // Never employer stock: the employer plan names tickers.
        const named = { ...choosing("speculative"), employerStockPlan: { ...POLICY.employerStockPlan, symbols: ["ACME"] } };
        assert.deepEqual(fund(named), ["manual:m1", "speculative", ["unknown"], false]);
        assert.equal(chosenBucket(choosing("active"), "MANUAL:M1"), "active");
    });

    test("regression: a choice moves Today's checks, but never the single-name ones", () => {
        const before = evaluateRiskPolicy(ONE_STOCK, POLICY);
        const after = evaluateRiskPolicy(ONE_STOCK, choosing("speculative"));
        assert.equal(check(before, "speculative_options_exposure").status, "inside");
        assert.equal(check(after, "speculative_options_exposure").status, "breached");
        // The $90,000 fund of the $100,000.
        assert.ok(Math.abs((check(after, "speculative_options_exposure").currentPct ?? Number.NaN) - 90) < 1e-9);
        assert.ok(Math.abs((check(after, "single_name_concentration").currentPct ?? Number.NaN) - 10) < 1e-9);
        assert.deepEqual(check(after, "single_name_concentration").impactedSymbols, ["ACME"]);
        // ACME has no theme on record, so it is missing metadata before and
        // after; the fund's unknown theme never is.
        for (const summary of [before, after]) {
            assert.equal(check(summary, "missing_policy_metadata").currentLabel, "1 holding");
            assert.equal(check(summary, "missing_policy_metadata").currentValueUsd, 10_000);
        }
        const fundOnly = evaluateRiskPolicy({ ...ONE_STOCK, holdings: [] }, choosing("speculative"));
        assert.equal(check(fundOnly, "missing_policy_metadata").status, "inside");
        assert.equal(check(fundOnly, "speculative_options_exposure").status, "breached");
    });

    test("one chosen as cash reserve takes no loss in a broad drawdown; left in core it takes its share", () => {
        const fundImpact = (policy: RiskPolicySettings) => evaluateRiskPolicy(ONE_STOCK, policy).stressTests
            .find((result) => result.scenarioId === "broad_market_20_tech_beta")!
            .contributors.find((contributor) => bucketChoiceKey(contributor.symbol) === "manual:m1")?.impactUsd ?? 0;
        assert.equal(fundImpact(POLICY), -18_000);
        assert.equal(fundImpact(choosing("cash_reserve")), 0);
    });

    test("ticker and hand-valued choices never mix", () => {
        const policy = choosing("speculative");
        assert.deepEqual(policyHoldings(ONE_STOCK.holdings, policy).map((row) => row.policyBucket), [null]);
        assert.equal(chosenBucketForTrade(policy, "manual:m1", "equity"), undefined);
        assert.equal(chosenBucketForTrade(policy, "MANUAL:M1", "equity"), undefined);
    });

    test("are named by their name wherever the policy lists them, never by their key", () => {
        assert.equal(policyHoldingLabel("TSLA"), "TSLA");
        assert.equal(policyHoldingLabel("TSLA", "Tesla"), "TSLA");
        assert.equal(policyHoldingLabel("MANUAL:M1", "Target 2055 Trust"), "Target 2055 Trust");
        assert.equal(policyHoldingLabel("manual:m1"), HAND_VALUED_LABEL);
        assert.equal(policyHoldingLabel("manual:m1", "  "), "Valued by hand");
        assert.equal(handValuedNames(ONE_STOCK).get(bucketChoiceKey("MANUAL:M1")), "Target 2055 Trust");
        assert.equal(handValuedNames(EMPTY_POLICY_PORTFOLIO).size, 0);
    });
});

describe("bucketChoiceKey", () => {
    test("a ticker in upper case; a holding valued by hand as manual: and its id in lower case", () => {
        assert.equal(bucketChoiceKey(" brk.b "), "BRK.B");
        assert.equal(bucketChoiceKey("MANUAL:00000000-0000-4000-8000-0000000000AB"), "manual:00000000-0000-4000-8000-0000000000ab");
        assert.equal(bucketChoiceKey("manual:m1"), "manual:m1");
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

    test("regression: trading activity is measured back from today, not from the last trade", () => {
        const old = (id: string, type: string, date: string) => ({ id, date, type, ticker: "MSFT", amount: 1_000 });
        const portfolio = { ...PORTFOLIO, trades: [old("t1", "buy", "2026-07-01"), old("t2", "sell", "2026-07-08"), old("t3", "buy", "2026-07-15")] };
        const churn = (asOf?: Date) => evaluateRiskPolicy(portfolio, POLICY, { asOf }).dimensions.find((d) => d.id === "churn_activity")!;
        // MSFT traded back and forth in July: within 90 days of the last trade, not of Oct 26.
        assert.deepEqual(churn().impactedSymbols, ["MSFT"]);
        assert.deepEqual(churn(new Date("2026-10-26T12:00:00Z")).impactedSymbols, []);
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

    test("the user's option positions (launch item i63): in the checks and the portfolio's worth", () => {
        const call = {
            id: "o1", underlying: "AAPL", contractType: "call" as const, strike: 250, expiry: "2027-01-15",
            quantity: 3, premiumPaid: 18.2, currentPremium: 21.4,
        };
        const portfolio = { ...PORTFOLIO, options: [call] };
        assert.deepEqual(riskPolicyInput(portfolio, POLICY).optionPositions, [call]);
        // 3 contracts × 100 × $21.40.
        assert.equal(policyPortfolioValue(portfolio), 110_000 + 6_420);
        const speculative = evaluateRiskPolicy(portfolio, POLICY).dimensions.find((d) => d.id === "speculative_options_exposure")!;
        assert.match(speculative.explanation, /Options premium at risk is \$5,460/);
    });

    test("regression: a written option counts against the portfolio's worth, not for it", () => {
        const written = {
            id: "o2", underlying: "AAPL", contractType: "call" as const, strike: 250, expiry: "2027-01-15",
            quantity: -1, premiumPaid: 12, currentPremium: 10,
        };
        const cashOnly = { ...EMPTY_POLICY_PORTFOLIO, cashTotal: 10_000, options: [written] };
        assert.equal(policyPortfolioValue(cashOnly), 9_000);
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

    test("a holding valued by hand goes by manual: and its id in lower case", () => {
        assert.deepEqual(withBucketChoice({}, "MANUAL:M1", "core", []), { "manual:m1": "core" });
        assert.deepEqual(withBucketChoice({ "manual:m1": "core", VTI: "core" }, "manual:M1", null, []), { VTI: "core" });
    });

    test("past the limit, held holdings valued by hand stay beside held tickers", () => {
        const full = Object.fromEntries(Array.from({ length: MAX_BUCKET_ASSIGNMENTS - 2 }, (_, i) => [`OLD${i}`, "core" as const]));
        const choices = { ...full, "manual:m1": "speculative" as const, "manual:gone": "active" as const };
        const next = withBucketChoice(choices, "NEW", "active", ["NEW", "OLD7", "MANUAL:M1"]);
        assert.deepEqual(next, { OLD7: "core", "manual:m1": "speculative", NEW: "active" });
    });
});

describe("chosenBucketForTrade", () => {
    test("the choice for a stock order's ticker, held or not; none for an option", () => {
        const policy = { bucketAssignments: { MSFT: "speculative" as const } };
        assert.equal(chosenBucketForTrade(policy, "msft", "equity"), "speculative");
        assert.equal(chosenBucketForTrade(policy, "MSFT", "option"), undefined);
        assert.equal(chosenBucketForTrade(policy, "AAPL", "equity"), undefined);
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
