/**
 * The Trade ticket's data, loaded on the server (launch item i53): the
 * user's accounts with their cash and positions, the last price Atlas has
 * for each held ticker, and their order plans. Tickers they don't hold are
 * priced in the browser from the same price store
 * (/api/market-data/quotes).
 */

import { isDatabaseConfigured } from "@/db/connection-options";
import { loggableError } from "@/lib/observability/loggable-error";
import { buildDashboardPortfoliosQuery } from "@/lib/portfolio-repository";
import { loadQuotes } from "@/lib/services/market-data-service";
import type { Order } from "@/types/execution";
import type { Quote } from "@/types/market-data";

import { loadUserOrderPlans } from "./orders";
import { EMPTY_TRADE_TICKET, ticketPriceFromQuote, type TicketAccount, type TicketPrice, type TradeTicketData } from "./ticket";

/** An account as the portfolio queries return it. */
export interface StoredTicketAccount {
    id: string;
    name: string;
    cashBalance?: number | null;
    holdings: readonly {
        symbol: string;
        quantity: string | number;
        avgCost: string | number;
        currentPrice?: number | null;
    }[];
}

/**
 * The ticket from what the server loaded. Accounts are in name order. A
 * held ticker is priced at its last stored close, else at the price stored
 * with the holding; without either it has no price.
 */
export function buildTradeTicket({
    accounts,
    quotes = {},
    orders = [],
}: {
    accounts: readonly StoredTicketAccount[];
    quotes?: Readonly<Record<string, Pick<Quote, "price" | "timestamp">>>;
    orders?: Order[];
}): TradeTicketData {
    const ticketAccounts: TicketAccount[] = [...accounts]
        .sort((a, b) => a.name.localeCompare(b.name, "en-US") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((account) => ({
            id: account.id,
            name: account.name,
            cash: Number(account.cashBalance) || 0,
            holdings: account.holdings.map((holding) => ({
                symbol: holding.symbol.toUpperCase(),
                quantity: Number(holding.quantity) || 0,
                avgCost: Number(holding.avgCost) || 0,
            })),
        }));

    const prices: Record<string, TicketPrice> = {};
    for (const account of accounts) {
        for (const holding of account.holdings) {
            const symbol = holding.symbol.toUpperCase();
            if (prices[symbol]) continue;
            const quote = quotes[symbol];
            const closed = quote ? ticketPriceFromQuote(quote) : undefined;
            const stored = Number(holding.currentPrice);
            if (closed) prices[symbol] = closed;
            else if (stored > 0) prices[symbol] = { price: stored };
        }
    }
    return { accounts: ticketAccounts, prices, orders, unavailable: false };
}

/**
 * The user's ticket. Without a configured database nothing is queried and
 * there are no accounts; when the database fails, `unavailable` says so.
 */
export async function loadTradeTicket(
    userId: string,
    { databaseConfigured = isDatabaseConfigured() }: { databaseConfigured?: boolean } = {},
): Promise<TradeTicketData> {
    if (!databaseConfigured) return EMPTY_TRADE_TICKET;
    try {
        const [accounts, orders] = await Promise.all([buildDashboardPortfoliosQuery(userId), loadUserOrderPlans(userId)]);
        const quotes = await loadQuotes(accounts.flatMap((account) => account.holdings.map((holding) => holding.symbol)));
        return buildTradeTicket({ accounts, quotes, orders });
    } catch (error) {
        // Logged during a render, so an AggregateError can't go to the console as is.
        console.error("Trade ticket fetch failed — showing the outage notice.", loggableError(error));
        return { ...EMPTY_TRADE_TICKET, unavailable: true };
    }
}
