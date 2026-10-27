import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { orderPlanCreateSchema } from "@/lib/validators/order-plan";
import type { Order } from "@/types/execution";

import {
    cashAfterOrder,
    defaultTicketAccountId,
    describeTicketPrice,
    orderDisplayPrice,
    orderNeedsApproval,
    orderPlanInput,
    orderValue,
    positionIn,
    ticketPriceFromQuote,
    type TicketAccount,
    type TicketDraft,
} from "./ticket";

const MAIN: TicketAccount = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Main",
    cash: 1_000,
    holdings: [{ symbol: "AAPL", quantity: 10, avgCost: 150 }, { symbol: "NVDA", quantity: 2, avgCost: 400 }],
};
const IRA: TicketAccount = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "IRA",
    cash: 0,
    holdings: [{ symbol: "NVDA", quantity: 5, avgCost: 300 }],
};

describe("ticket prices", () => {
    test("a stored close keeps its Eastern date: a 4 PM ET close is that day, not the next UTC one", () => {
        assert.deepEqual(ticketPriceFromQuote({ price: 205, timestamp: "2026-10-26T20:00:00.000Z" }), { price: 205, closeDate: "2026-10-26" });
    });

    test("no price, a zero price or a broken time isn't made into a price", () => {
        assert.equal(ticketPriceFromQuote({ price: 0, timestamp: "2026-10-26T20:00:00.000Z" }), undefined);
        assert.equal(ticketPriceFromQuote({ price: Number.NaN, timestamp: "2026-10-26T20:00:00.000Z" }), undefined);
        assert.deepEqual(ticketPriceFromQuote({ price: 5, timestamp: "soon" }), { price: 5 });
    });

    test("the label says where the price came from, never that it's live", () => {
        assert.equal(describeTicketPrice(undefined, "2026-10-27"), "No price yet");
        assert.equal(describeTicketPrice({ price: 1 }, "2026-10-27"), "Price stored with your holding");
        assert.equal(describeTicketPrice({ price: 1, closeDate: "2026-10-27" }, "2026-10-27"), "Today's close");
        assert.equal(describeTicketPrice({ price: 1, closeDate: "2026-10-23" }, "2026-10-27"), "Last close, Oct 23");
        assert.equal(describeTicketPrice({ price: 1, closeDate: "2025-12-31" }, "2026-10-27"), "Last close, Dec 31, 2025");
    });
});

describe("ticket positions and accounts", () => {
    test("an account's position in a ticker, in any case; none when it holds none", () => {
        assert.deepEqual(positionIn(MAIN, "aapl"), { symbol: "AAPL", quantity: 10, avgCost: 150 });
        assert.deepEqual(positionIn(MAIN, "TSLA"), { symbol: "TSLA", quantity: 0, avgCost: 0 });
        assert.deepEqual(positionIn(undefined, "TSLA"), { symbol: "TSLA", quantity: 0, avgCost: 0 });
    });

    test("the ticket opens on the account holding the most of the ticker, else the one with the most positions", () => {
        assert.equal(defaultTicketAccountId([MAIN, IRA], "NVDA"), IRA.id);
        assert.equal(defaultTicketAccountId([MAIN, IRA], "AAPL"), MAIN.id);
        assert.equal(defaultTicketAccountId([IRA, MAIN], "TSLA"), MAIN.id);
        assert.equal(defaultTicketAccountId([IRA, MAIN]), MAIN.id);
        // Of equals, the first (the accounts come in name order).
        const empty = { ...IRA, id: "c", holdings: [] };
        assert.equal(defaultTicketAccountId([empty, { ...empty, id: "d" }]), "c");
        assert.equal(defaultTicketAccountId([], "AAPL"), undefined);
    });

    test("a buy spends the account's cash and a sell adds to it", () => {
        assert.equal(cashAfterOrder(1_000, "buy", 1_500), -500);
        assert.equal(cashAfterOrder(1_000, "sell", 1_500), 2_500);
    });
});

describe("order plan values", () => {
    const plan = (overrides: Partial<Order>): Order => ({
        id: "p1",
        portfolioId: MAIN.id,
        instrumentType: "equity",
        ticker: "AAPL",
        side: "buy",
        type: "limit",
        quantity: 10,
        limitPrice: 200,
        stopPrice: 190,
        referencePrice: 205,
        timeInForce: "day",
        status: "ready",
        createdAt: "2026-10-27T15:00:00.000Z",
        updatedAt: "2026-10-27T15:00:00.000Z",
        ...overrides,
    });

    test("a plan is valued at the price its order type uses", () => {
        assert.equal(orderValue(plan({ type: "limit" })), 2_000);
        assert.equal(orderValue(plan({ type: "stop_limit" })), 2_000);
        assert.equal(orderValue(plan({ type: "stop" })), 1_900);
        assert.equal(orderValue(plan({ type: "market" })), 2_050);
        assert.equal(orderDisplayPrice(plan({ type: "market", referencePrice: undefined })), undefined);
        assert.equal(orderValue(plan({ type: "market", referencePrice: undefined })), 0);
    });

    test("an option plan is shown at its premium and valued at the premium at risk", () => {
        const option = plan({
            instrumentType: "option",
            limitPrice: 4.5,
            optionDetails: {
                underlying: "AAPL", contractType: "call", strike: 250, expiry: "2027-01-15", premium: 4.5,
                contractMultiplier: 100, premiumAtRisk: 4_500, notionalEquivalent: 250_000,
                maxLossAcknowledged: true, whatMustBeTrueByExpiry: "x", plannedExitRule: "y",
            },
        });
        assert.equal(orderDisplayPrice(option), 4.5);
        assert.equal(orderValue(option), 4_500);
    });

    test("approval is needed only above the threshold, and only when it's on", () => {
        const on = { approvalThresholdEnabled: true, approvalThresholdUsd: 25_000 };
        assert.equal(orderNeedsApproval(25_000, on), false);
        assert.equal(orderNeedsApproval(25_000.01, on), true);
        assert.equal(orderNeedsApproval(1e9, { ...on, approvalThresholdEnabled: false }), false);
    });
});

describe("orderPlanInput", () => {
    const draft = (overrides: Partial<TicketDraft> = {}): TicketDraft => ({
        portfolioId: MAIN.id,
        instrumentType: "equity",
        ticker: " ibm ",
        side: "buy",
        type: "limit",
        quantity: 3,
        limitPrice: 204,
        stopPrice: 199,
        timeInForce: "gtc",
        price: { price: 205, closeDate: "2026-10-27" },
        needsApproval: false,
        policy: { decision: "allowed", summary: "Inside policy", exceptionPreview: [] },
        overrideReason: "  ",
        ...overrides,
    });

    test("keeps only the prices the order type uses, and the price it was sized at", () => {
        const input = orderPlanInput(draft());
        assert.equal(input.ticker, "IBM");
        assert.equal(input.limitPrice, 204);
        assert.equal(input.stopPrice, undefined);
        assert.equal(input.referencePrice, 205);
        assert.equal(input.referencePriceDate, "2026-10-27");
        assert.deepEqual(input.policy, { decision: "allowed", summary: "Inside policy", exceptions: [] });
        assert.equal(orderPlanCreateSchema.safeParse(input).success, true);

        const stop = orderPlanInput(draft({ type: "stop" }));
        assert.equal(stop.limitPrice, undefined);
        assert.equal(stop.stopPrice, 199);
        assert.equal(orderPlanCreateSchema.safeParse(stop).success, true);

        const market = orderPlanInput(draft({ type: "market" }));
        assert.equal(market.limitPrice, undefined);
        assert.equal(market.stopPrice, undefined);
        assert.equal(orderPlanCreateSchema.safeParse(market).success, true);
    });

    test("a price stored with the holding has no close date; without a price none is sent", () => {
        const stored = orderPlanInput(draft({ price: { price: 182.45 } }));
        assert.equal(stored.referencePrice, 182.45);
        assert.equal("referencePriceDate" in stored, false);
        const unpriced = orderPlanInput(draft({ price: undefined }));
        assert.equal("referencePrice" in unpriced, false);
        assert.equal(orderPlanCreateSchema.safeParse(unpriced).success, true);
    });

    test("the override reason is kept only with the exceptions it overrode", () => {
        const exception = {
            ruleType: "single_position_allocation" as const, symbol: "IBM", reason: "Planned rebalance into IBM",
            currentPct: 20, postPct: 30, thresholdPct: 25, message: "Over the cap", capturedAt: "2026-10-27T15:00:00.000Z",
        };
        const overridden = orderPlanInput(draft({
            policy: { decision: "override_required", summary: "Override captured", exceptionPreview: [exception] },
            overrideReason: " Planned rebalance into IBM ",
        }));
        assert.deepEqual(overridden.policy, {
            decision: "override_required", summary: "Override captured", exceptions: [exception], overrideReason: "Planned rebalance into IBM",
        });
        assert.equal(orderPlanCreateSchema.safeParse(overridden).success, true);
        assert.equal(orderPlanInput(draft({ overrideReason: "unused reason" })).policy?.overrideReason, undefined);
    });

    test("an option plan carries its details, not a share price", () => {
        const optionDetails = {
            underlying: "IBM", contractType: "call" as const, strike: 250, expiry: "2027-01-15", premium: 4.5,
            contractMultiplier: 100, premiumAtRisk: 450, notionalEquivalent: 25_000,
            maxLossAcknowledged: true, whatMustBeTrueByExpiry: "Margins expand", plannedExitRule: "Close at 50% loss",
        };
        const input = orderPlanInput(draft({ instrumentType: "option", quantity: 1, limitPrice: 4.5, optionDetails }));
        assert.equal("referencePrice" in input, false);
        assert.deepEqual(input.optionDetails, optionDetails);
        assert.equal(orderPlanCreateSchema.safeParse(input).success, true);
    });
});
