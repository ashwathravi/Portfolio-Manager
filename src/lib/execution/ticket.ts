/**
 * The Trade ticket on the user's own data (launch item i53): their
 * accounts with cash and positions, the last price Atlas has for each
 * ticker, and their saved order plans. Browser-safe; the server loads it
 * in ./server.ts.
 */

import { getEasternParts } from "@/lib/markets/market-hours";
import type { PreTradeRiskPolicyImpact } from "@/lib/risk-policy";
import type { Order, OrderInstrumentType, OrderOptionDetails, OrderPlanInput, OrderSide, OrderType, TimeInForce } from "@/types/execution";
import type { Quote } from "@/types/market-data";
import type { TradeRationale } from "@/types/trade";

export interface TicketHolding {
    symbol: string;
    quantity: number;
    avgCost: number;
}

export interface TicketAccount {
    id: string;
    name: string;
    /** The account's cash as Atlas has it (entered, imported or synced). */
    cash: number;
    holdings: TicketHolding[];
}

/**
 * A ticker's last price: a session's close from the price store, with its
 * Eastern date, or, before the store has one, the price stored with the
 * user's holding (no date). Never a live quote.
 */
export interface TicketPrice {
    price: number;
    closeDate?: string;
}

export interface TradeTicketData {
    accounts: TicketAccount[];
    /** By upper-case ticker. */
    prices: Record<string, TicketPrice>;
    /** Newest first. */
    orders: Order[];
    /** A configured database failed to answer: the page says so instead of an empty ticket. */
    unavailable: boolean;
}

export const EMPTY_TRADE_TICKET: TradeTicketData = { accounts: [], prices: {}, orders: [], unavailable: false };

/** An option contract covers 100 shares. */
export const OPTION_CONTRACT_MULTIPLIER = 100;

/** A quote from the price store as a ticket price; undefined without a positive price. */
export function ticketPriceFromQuote(quote: Pick<Quote, "price" | "timestamp">): TicketPrice | undefined {
    if (!(Number.isFinite(quote.price) && quote.price > 0)) return undefined;
    const at = new Date(quote.timestamp);
    return Number.isNaN(at.getTime()) ? { price: quote.price } : { price: quote.price, closeDate: getEasternParts(at).date };
}

const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Where the ticket's price comes from, in a few words; `today` is the Eastern date. */
export function describeTicketPrice(price: TicketPrice | undefined, today: string): string {
    if (!price) return "No price yet";
    if (!price.closeDate) return "Price stored with your holding";
    if (price.closeDate === today) return "Today's close";
    const date = new Date(`${price.closeDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return "Last close";
    const format = price.closeDate.slice(0, 4) === today.slice(0, 4) ? MONTH_DAY : MONTH_DAY_YEAR;
    return `Last close, ${format.format(date)}`;
}

/** What an account holds of a ticker; nothing when it holds none. */
export function positionIn(account: TicketAccount | undefined, ticker: string): TicketHolding {
    const symbol = ticker.trim().toUpperCase();
    const holding = account?.holdings.find((h) => h.symbol.toUpperCase() === symbol);
    return holding ? { ...holding, symbol } : { symbol, quantity: 0, avgCost: 0 };
}

/**
 * The account a ticket opens on: the one holding the most of the ticker,
 * else the one with the most positions; the first of equals.
 */
export function defaultTicketAccountId(accounts: readonly TicketAccount[], ticker?: string): string | undefined {
    if (ticker) {
        let best: { id: string; quantity: number } | undefined;
        for (const account of accounts) {
            const quantity = positionIn(account, ticker).quantity;
            if (quantity > 0 && (!best || quantity > best.quantity)) best = { id: account.id, quantity };
        }
        if (best) return best.id;
    }
    let busiest: TicketAccount | undefined;
    for (const account of accounts) {
        if (!busiest || account.holdings.length > busiest.holdings.length) busiest = account;
    }
    return busiest?.id;
}

/** The price a plan is shown at: an option's premium, else its limit, its stop, or what a market order was sized at. */
export function orderDisplayPrice(order: Pick<Order, "type" | "limitPrice" | "stopPrice" | "referencePrice" | "optionDetails">): number | undefined {
    if (order.optionDetails) return order.optionDetails.premium;
    if (order.type === "limit" || order.type === "stop_limit") return order.limitPrice;
    if (order.type === "stop") return order.stopPrice;
    return order.referencePrice;
}

/** What a plan puts at stake: an option's premium, else shares at its price. */
export function orderValue(order: Pick<Order, "type" | "quantity" | "limitPrice" | "stopPrice" | "referencePrice" | "optionDetails">): number {
    if (order.optionDetails) return order.optionDetails.premiumAtRisk;
    return (orderDisplayPrice(order) ?? 0) * order.quantity;
}

/** Above the user's approval threshold (Settings › Guardrails), when it's on. */
export function orderNeedsApproval(value: number, guardrails: { approvalThresholdEnabled: boolean; approvalThresholdUsd: number }): boolean {
    return guardrails.approvalThresholdEnabled && value > guardrails.approvalThresholdUsd;
}

/** The account's cash once the order is placed: a buy spends it, a sell adds to it. */
export function cashAfterOrder(cash: number, side: OrderSide, value: number): number {
    return side === "buy" ? cash - value : cash + value;
}

/** What the ticket knows when the user submits. */
export interface TicketDraft {
    portfolioId: string;
    instrumentType: OrderInstrumentType;
    ticker: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    limitPrice: number;
    stopPrice: number;
    timeInForce: TimeInForce;
    /** The ticker's last price, when Atlas has one. */
    price?: TicketPrice;
    needsApproval: boolean;
    rationale?: TradeRationale;
    optionDetails?: OrderOptionDetails;
    policy: Pick<PreTradeRiskPolicyImpact, "decision" | "summary" | "exceptionPreview">;
    overrideReason: string;
}

/**
 * The plan to save: only the prices its order type uses, the price it was
 * sized at (a share's last price; an option's premium is in its details),
 * and the policy's verdict with any exceptions the user overrode.
 */
export function orderPlanInput(draft: TicketDraft): OrderPlanInput {
    const usesLimit = draft.type === "limit" || draft.type === "stop_limit";
    const usesStop = draft.type === "stop" || draft.type === "stop_limit";
    const priced = draft.instrumentType === "equity" && draft.price && draft.price.price > 0 ? draft.price : undefined;
    const exceptions = draft.policy.exceptionPreview;
    const overrideReason = draft.overrideReason.trim();
    return {
        portfolioId: draft.portfolioId,
        instrumentType: draft.instrumentType,
        ticker: draft.ticker.trim().toUpperCase(),
        side: draft.side,
        type: draft.type,
        quantity: draft.quantity,
        ...(usesLimit ? { limitPrice: draft.limitPrice } : {}),
        ...(usesStop ? { stopPrice: draft.stopPrice } : {}),
        timeInForce: draft.timeInForce,
        ...(priced ? { referencePrice: priced.price, ...(priced.closeDate ? { referencePriceDate: priced.closeDate } : {}) } : {}),
        needsApproval: draft.needsApproval,
        ...(draft.rationale ? { rationale: draft.rationale } : {}),
        ...(draft.optionDetails ? { optionDetails: draft.optionDetails } : {}),
        policy: {
            decision: draft.policy.decision,
            summary: draft.policy.summary,
            exceptions,
            ...(exceptions.length > 0 && overrideReason ? { overrideReason } : {}),
        },
    };
}
