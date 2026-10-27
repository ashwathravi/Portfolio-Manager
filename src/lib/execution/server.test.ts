import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { orderPlans } from "@/db/schema";

import { buildUserOrderPlansQueries, CLOSED_ORDER_PLANS_SHOWN, orderFromRow } from "./orders";
import { buildTradeTicket, loadTradeTicket } from "./server";
import { EMPTY_TRADE_TICKET } from "./ticket";

describe("trade ticket loads", () => {
    test("without a configured database nothing is queried and there are no accounts", async () => {
        assert.deepEqual(await loadTradeTicket("user-a", { databaseConfigured: false }), EMPTY_TRADE_TICKET);
    });

    test("accounts in name order with their cash and positions; held tickers at their last close, else their stored price", () => {
        const ticket = buildTradeTicket({
            accounts: [
                {
                    id: "b",
                    name: "Main",
                    cashBalance: 12_450,
                    holdings: [
                        { symbol: "aapl", quantity: "500", avgCost: "165.3", currentPrice: 182.45 },
                        { symbol: "IBM", quantity: "2", avgCost: "150", currentPrice: 190 },
                        { symbol: "NEW", quantity: "1", avgCost: "10", currentPrice: null },
                    ],
                },
                { id: "a", name: "IRA", cashBalance: null, holdings: [{ symbol: "AAPL", quantity: 5, avgCost: 100, currentPrice: 170 }] },
            ],
            quotes: { IBM: { price: 205, timestamp: "2026-10-26T20:00:00.000Z" } },
        });
        assert.deepEqual(ticket.accounts, [
            { id: "a", name: "IRA", cash: 0, holdings: [{ symbol: "AAPL", quantity: 5, avgCost: 100 }] },
            {
                id: "b",
                name: "Main",
                cash: 12_450,
                holdings: [
                    { symbol: "AAPL", quantity: 500, avgCost: 165.3 },
                    { symbol: "IBM", quantity: 2, avgCost: 150 },
                    { symbol: "NEW", quantity: 1, avgCost: 10 },
                ],
            },
        ]);
        // The close outranks the stored price; with neither there's no price, not $0.
        assert.deepEqual(ticket.prices, { AAPL: { price: 182.45 }, IBM: { price: 205, closeDate: "2026-10-26" } });
        assert.equal(ticket.unavailable, false);
    });
});

describe("order plan queries", () => {
    test("open plans all, placed and cancelled ones the newest few, only the user's", () => {
        const { open, closed } = buildUserOrderPlansQueries("user-a");
        const openSql = open.toSQL();
        assert.match(openSql.sql, /where \("order_plans"."user_id" = \$1 and "order_plans"."status" in \(\$2, \$3\)\)/);
        assert.deepEqual(openSql.params, ["user-a", "pending_approval", "ready"]);
        assert.doesNotMatch(openSql.sql, /limit \$/);
        const closedSql = closed.toSQL();
        assert.match(closedSql.sql, /"order_plans"."status" not in \(\$2, \$3\)/);
        assert.match(closedSql.sql, /order by "order_plans"."created_at" desc, "order_plans"."id" asc limit \$4$/);
        assert.deepEqual(closedSql.params, ["user-a", "pending_approval", "ready", CLOSED_ORDER_PLANS_SHOWN]);
    });

    test("a stored plan reads back as the blotter's order, without the columns it doesn't use", () => {
        const row: typeof orderPlans.$inferSelect = {
            id: "p1",
            userId: "user-a",
            portfolioId: "acct",
            instrumentType: "equity",
            symbol: "IBM",
            side: "buy",
            orderType: "market",
            quantity: "2.5",
            limitPrice: null,
            stopPrice: null,
            timeInForce: "day",
            status: "ready",
            referencePrice: 205,
            referencePriceDate: "2026-10-26",
            rationale: null,
            optionDetails: null,
            policy: { decision: "allowed", summary: "Inside policy", exceptions: [] },
            createdAt: new Date("2026-10-27T15:00:00.000Z"),
            updatedAt: new Date("2026-10-27T15:01:00.000Z"),
        };
        assert.deepEqual(orderFromRow(row), {
            id: "p1",
            portfolioId: "acct",
            instrumentType: "equity",
            ticker: "IBM",
            side: "buy",
            type: "market",
            quantity: 2.5,
            timeInForce: "day",
            status: "ready",
            referencePrice: 205,
            referencePriceDate: "2026-10-26",
            createdAt: "2026-10-27T15:00:00.000Z",
            updatedAt: "2026-10-27T15:01:00.000Z",
            policy: { decision: "allowed", summary: "Inside policy", exceptions: [] },
        });
        assert.deepEqual(orderFromRow({ ...row, orderType: "stop_limit", limitPrice: "204.5", stopPrice: "199" }).limitPrice, 204.5);
        assert.equal("userId" in orderFromRow(row), false);
    });
});
