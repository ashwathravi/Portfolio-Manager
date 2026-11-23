import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { ActivityRow } from "@/lib/portfolio/activity";
import type { SecurityProfile } from "@/lib/markets/security-profile";

import { computeBucketAllocation } from "./buckets";
import { DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN } from "./de-risking";
import { MAX_CHURN_WINDOW_DAYS, buildPolicyPortfolio, policyAllocationHoldings, valueHolding } from "./portfolio";
import { policyHandValued, policyHoldings, type RiskPolicySettings } from "./user-policy";

const profile = (symbol: string, type: string, sector: SecurityProfile["sector"], name: string): SecurityProfile => ({
    symbol,
    name,
    type,
    sector,
    industry: null,
});

function activity(id: string, date: string, side: ActivityRow["side"], symbol: string | null, value: number): ActivityRow {
    return { id, date, symbol, side, quantity: 1, price: value, value, account: "Brokerage", notes: null, fees: null, currency: "USD" } as ActivityRow;
}

describe("valueHolding", () => {
    test("a live quote values it now; then the stored value; then the stored price; then cost", () => {
        const holding = { id: "h", symbol: "KO", quantity: "10", avgCost: "50", currentPrice: 60, marketValue: 620 };
        assert.deepEqual(valueHolding(holding, 70), { quantity: 10, avgCost: 50, currentPrice: 70, marketValue: 700 });
        assert.equal(valueHolding(holding).marketValue, 620);
        assert.equal(valueHolding({ ...holding, marketValue: null }).marketValue, 600);
        assert.equal(valueHolding({ ...holding, marketValue: null, currentPrice: null }).marketValue, 500);
    });
});

describe("buildPolicyPortfolio", () => {
    const accounts = [
        { cashBalance: 1_000, holdings: [{ id: "a1", symbol: "VTI", name: null, quantity: "10", avgCost: "200", currentPrice: 250, marketValue: null }] },
        { cashBalance: null, holdings: [{ id: "b1", symbol: "msft", name: "Microsoft", quantity: "5", avgCost: "300", currentPrice: null, marketValue: null }] },
    ];

    test("every account's holdings, valued, named, and in the bucket their type suggests", () => {
        const portfolio = buildPolicyPortfolio({
            accounts,
            quotes: { MSFT: { price: 400 } },
            profiles: new Map([
                ["VTI", profile("VTI", "ETF", "Funds", "Vanguard Total Stock Market ETF")],
                ["MSFT", profile("MSFT", "CS", "Tech", "Microsoft Corp")],
            ]),
        });
        assert.equal(portfolio.cashTotal, 1_000);
        assert.deepEqual(portfolio.holdings, [
            { id: "a1", symbol: "VTI", name: "Vanguard Total Stock Market ETF", quantity: 10, avgCost: 200, currentPrice: 250, marketValue: 2_500, defaultBucket: "core" },
            { id: "b1", symbol: "msft", name: "Microsoft Corp", quantity: 5, avgCost: 300, currentPrice: 400, marketValue: 2_000, defaultBucket: "active" },
        ]);
    });

    test("holdings valued by hand are their own list, at their value, in the core bucket", () => {
        const portfolio = buildPolicyPortfolio({
            accounts: [{ holdings: [], manualHoldings: [
                { id: "m1", name: "Stable Value Fund", value: "1500.5", costBasis: "1200" },
                { id: "m2", name: "Private Co", value: 300, costBasis: null },
            ] }],
        });
        assert.deepEqual(portfolio.holdings, []);
        assert.deepEqual(portfolio.handValued, [
            { id: "m1", symbol: "manual:m1", name: "Stable Value Fund", quantity: 1, avgCost: 1_200, currentPrice: 1_500.5, marketValue: 1_500.5, defaultBucket: "core" },
            { id: "m2", symbol: "manual:m2", name: "Private Co", quantity: 1, avgCost: 300, currentPrice: 300, marketValue: 300, defaultBucket: "core" },
        ]);
    });

    test("holdings valued by hand carry their account's name; tickers never do", () => {
        const portfolio = buildPolicyPortfolio({
            accounts: [
                { name: "Retirement", holdings: [{ id: "h1", symbol: "VTI", quantity: 1, avgCost: 1 }], manualHoldings: [{ id: "m1", name: "Stable Value Fund", value: 100 }] },
                { holdings: [], manualHoldings: [{ id: "m2", name: "Private Co", value: 300 }] },
            ],
        });
        const [named, unnamed] = portfolio.handValued ?? [];
        assert.equal(named.account, "Retirement");
        // Without an account name there is no account key at all.
        assert.equal(Object.hasOwn(unnamed, "account"), false);
        assert.equal(Object.hasOwn(portfolio.holdings[0], "account"), false);
    });

    test("without reference data only the well-known tickers have a bucket", () => {
        const portfolio = buildPolicyPortfolio({
            accounts: [{ holdings: [
                { id: "1", symbol: "VTI", quantity: 1, avgCost: 1 },
                { id: "2", symbol: "ZZZZ", quantity: 1, avgCost: 1 },
            ] }],
        });
        assert.deepEqual(portfolio.holdings.map((holding) => holding.defaultBucket), ["core", null]);
    });

    test("buys and sells only, within the longest trading-activity window", () => {
        const asOf = new Date("2026-10-26T12:00:00Z");
        const old = new Date(asOf.getTime() - (MAX_CHURN_WINDOW_DAYS + 2) * 86_400_000).toISOString();
        const portfolio = buildPolicyPortfolio({
            accounts: [],
            activity: [
                activity("t1", "2026-10-20T15:00:00Z", "BUY", "KO", 600),
                activity("t2", "2026-10-21T15:00:00Z", "DIVIDEND", "KO", 12),
                activity("t3", "2026-10-22T15:00:00Z", "SELL", "KO", 640),
                activity("t4", old, "BUY", "PG", 100),
            ],
            theses: [{ id: "th", ticker: "KO" }],
            asOf,
        });
        assert.deepEqual(portfolio.trades, [
            { id: "t1", date: "2026-10-20T15:00:00Z", type: "buy", ticker: "KO", amount: 600 },
            { id: "t3", date: "2026-10-22T15:00:00Z", type: "sell", ticker: "KO", amount: 640 },
        ]);
        assert.deepEqual(portfolio.theses, [{ id: "th", ticker: "KO" }]);
        assert.deepEqual(portfolio.options, []);
        // Dollars only: a trade in another currency isn't turnover in dollars.
        const cad = buildPolicyPortfolio({ accounts: [], activity: [{ ...activity("c1", "2026-10-20T15:00:00Z", "BUY", "SHOP", 100), currency: "CAD" }], asOf });
        assert.deepEqual(cad.trades, []);
        // Without a date, every buy and sell is kept.
        assert.equal(buildPolicyPortfolio({ accounts: [], activity: [activity("t4", old, "BUY", "PG", 100)] }).trades.length, 1);
    });

    test("carries the user's option positions (launch item i63)", () => {
        const call = { id: "o1", underlying: "AAPL", contractType: "call" as const, strike: 250, expiry: "2027-01-15", quantity: 3, premiumPaid: 18.2, currentPremium: 21.4 };
        assert.deepEqual(buildPolicyPortfolio({ accounts: [], options: [call] }).options, [call]);
    });
});

describe("policyAllocationHoldings", () => {
    const fund = "6f1e2c3d-4b5a-4c6d-8e7f-000000000001";
    const shares = "6f1e2c3d-4b5a-4c6d-8e7f-000000000002";
    const accounts = [
        {
            name: "Brokerage",
            cashBalance: 500,
            holdings: [
                { id: "h1", symbol: "tsla", quantity: 10, avgCost: 150, currentPrice: 200, marketValue: 2_000 },
                { id: "h2", symbol: "XMPL", quantity: 10, avgCost: 50, currentPrice: 60, marketValue: 600 },
                { id: "h3", symbol: "WXYZ", quantity: 10, avgCost: 30, currentPrice: 40, marketValue: 400 },
            ],
        },
        {
            name: "401(k)",
            holdings: [],
            manualHoldings: [
                { id: fund, name: "Target 2055 Trust", value: "9000" },
                { id: shares, name: "Private Co shares", value: 1_000 },
            ],
        },
    ];
    const profiles = new Map([["XMPL", profile("XMPL", "ETF", "Funds", "Example Total Market Fund")]]);
    // TSLA moved to core, and the private shares to speculative.
    const policy: Pick<RiskPolicySettings, "bucketAssignments" | "employerStockPlan"> = {
        bucketAssignments: { TSLA: "core", [`manual:${shares}`]: "speculative" },
        employerStockPlan: { ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN, symbols: [] },
    };

    test("a ticker is in the bucket the user chose, else the one it starts in", () => {
        const rows = policyAllocationHoldings({ accounts, profiles, quotes: { XMPL: { price: 70 } } }, policy);
        assert.deepEqual(rows.slice(0, 3), [
            // Chosen by its ticker in any case; speculative is only where it starts.
            { symbol: "tsla", portfolio: "Brokerage", marketValue: 2_000, policyBucket: "core", defaultBucket: "speculative" },
            // No choice: a fund is core, valued at its quote.
            { symbol: "XMPL", portfolio: "Brokerage", marketValue: 700, policyBucket: undefined, defaultBucket: "core" },
            // Nothing says what it is: unassigned until the user chooses.
            { symbol: "WXYZ", portfolio: "Brokerage", marketValue: 400, policyBucket: undefined, defaultBucket: null },
        ]);
    });

    test("a holding valued by hand is in the bucket chosen for it, core until then, with the theme that bucket implies", () => {
        const rows = policyAllocationHoldings({ accounts }, policy);
        assert.deepEqual(rows.slice(3), [
            {
                symbol: `manual:${fund}`,
                portfolio: "401(k)",
                marketValue: 9_000,
                policyBucket: "core",
                themeWeights: [{ theme: "broad_core_index", weight: 1, source: "fallback" }],
            },
            {
                symbol: `manual:${shares}`,
                portfolio: "401(k)",
                marketValue: 1_000,
                policyBucket: "speculative",
                themeWeights: [{ theme: "unknown", weight: 1, source: "unknown" }],
            },
        ]);
        // An account without a name has none to group by.
        const [unnamed] = policyAllocationHoldings({ accounts: [{ holdings: [], manualHoldings: [{ id: fund, name: "Fund", value: 1 }] }] }, policy);
        assert.equal(unnamed.portfolio, "");
    });

    test("regression: in the buckets the policy checks put them in, the user's choices applied", () => {
        const allocation = computeBucketAllocation(policyAllocationHoldings({ accounts, profiles }, policy));
        const portfolio = buildPolicyPortfolio({ accounts, profiles });
        const checks = computeBucketAllocation([
            ...policyHoldings(portfolio.holdings, policy),
            ...policyHandValued(portfolio.handValued ?? [], policy),
        ]);
        const byBucket = (rows: typeof allocation.rows) => rows.map((row) => [row.bucket, row.marketValue]);
        assert.deepEqual(byBucket(allocation.rows), byBucket(checks.rows));
        // TSLA counts in core, not in speculative where it starts.
        const value = (bucket: string) => allocation.rows.find((row) => row.bucket === bucket)?.marketValue;
        assert.equal(value("core"), 2_000 + 600 + 9_000);
        assert.equal(value("speculative"), 1_000);
        assert.equal(value("unassigned"), 400);
    });
});
