import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { ActivityRow } from "@/lib/portfolio/activity";
import type { SecurityProfile } from "@/lib/markets/security-profile";

import { MAX_CHURN_WINDOW_DAYS, buildPolicyPortfolio, valueHolding } from "./portfolio";

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
        // Dollars only: a trade in another currency isn't turnover in dollars.
        const cad = buildPolicyPortfolio({ accounts: [], activity: [{ ...activity("c1", "2026-10-20T15:00:00Z", "BUY", "SHOP", 100), currency: "CAD" }], asOf });
        assert.deepEqual(cad.trades, []);
        // Without a date, every buy and sell is kept.
        assert.equal(buildPolicyPortfolio({ accounts: [], activity: [activity("t4", old, "BUY", "PG", 100)] }).trades.length, 1);
    });
});
