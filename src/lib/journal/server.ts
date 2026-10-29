/**
 * Loading the user's trade journal (launch item i51): their closed trades
 * with what they recorded about them (src/lib/journal/trades.ts), for
 * Performance › Behaviour and Today's weekly review and patterns. Every
 * query is scoped to the user whose ID the page takes from the session.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { isDatabaseConfigured } from "@/db/connection-options";
import { orderPlans } from "@/db/schema";
import { orderFromRow } from "@/lib/execution/orders";
import { loggableError } from "@/lib/observability/loggable-error";
import { closeOn } from "@/lib/performance/holdings-returns";
import { storedClosesLoader, type ClosesLoader } from "@/lib/performance/return-history";
import { buildDashboardPortfoliosQuery, buildUserTransactionsQuery } from "@/lib/portfolio-repository";
import { toActivityRows, type ActivityRow } from "@/lib/portfolio/activity";
import { closedTrades, tickersLeftOut, type ClosedTrade } from "@/lib/portfolio/closed-trades";
import { loadJournal } from "@/lib/research/server/journal";
import { valueHolding, type StoredPolicyHolding } from "@/lib/risk-policy/portfolio";
import type { Order } from "@/types/execution";

import { tradeJournal, type TradeJournal, type TradeJournalSources } from "./trades";

/**
 * The closed trades in `rows`, checked against the split-adjusted closes
 * `loadCloses` reads for the tickers sold (from the first buy of one to
 * `now`), and the tickers that check left out (src/lib/portfolio/closed-trades.ts).
 */
export async function loadClosedTrades(
    rows: readonly ActivityRow[],
    loadCloses: ClosesLoader,
    now: Date = new Date(),
): Promise<{ trades: ClosedTrade[]; leftOut: string[] }> {
    const sold = new Set(rows.filter((row) => row.side === "SELL" && row.symbol).map((row) => row.symbol!));
    const firstBuy = rows
        .filter((row) => row.side === "BUY" && row.symbol && sold.has(row.symbol))
        .reduce<string | null>((first, row) => (first === null || row.date < first ? row.date : first), null);
    if (sold.size === 0 || !firstBuy) return { trades: [], leftOut: [] };
    const adjusted = await loadCloses([...sold], firstBuy.slice(0, 10), now.toISOString().slice(0, 10));
    const options = { adjustedClose: (symbol: string, date: string) => closeOn(adjusted.get(symbol), date) };
    return { trades: closedTrades(rows, options), leftOut: tickersLeftOut(rows, options) };
}

interface JournalAccount {
    id: string;
    name: string;
    cashBalance: number | null;
    holdings: StoredPolicyHolding[];
}

export interface TradeJournalLoaders {
    loadAccounts: (userId: string) => Promise<JournalAccount[]>;
    loadActivity: (userId: string) => Promise<ActivityRow[]>;
    loadOrders: (userId: string) => Promise<Order[]>;
    loadDecisions: (userId: string) => Promise<TradeJournalSources["decisions"]>;
    loadCloses: ClosesLoader;
}

/** The placed equity buys the user drafted on Trade: the orders a closed trade can have opened with. */
export function buildPlacedBuysQuery(userId: string, database: Pick<typeof db, "select"> = db) {
    return database.select().from(orderPlans)
        .where(and(
            eq(orderPlans.userId, userId),
            eq(orderPlans.status, "placed"),
            eq(orderPlans.side, "buy"),
            eq(orderPlans.instrumentType, "equity"),
        ))
        .orderBy(desc(orderPlans.createdAt));
}

const DATABASE_SOURCES: TradeJournalLoaders = {
    loadAccounts: (userId) => buildDashboardPortfoliosQuery(userId),
    loadActivity: async (userId) => toActivityRows(await buildUserTransactionsQuery(userId)),
    loadOrders: async (userId) => (await buildPlacedBuysQuery(userId)).map(orderFromRow),
    loadDecisions: async (userId) => (await loadJournal(userId)).entries,
    loadCloses: (symbols, from, to) => storedClosesLoader()(symbols, from, to),
};

/**
 * The user's trade journal. Pass what the page already loaded (`accounts`,
 * `activity`) to skip reading it again. Throws when the database fails.
 */
export async function loadTradeJournal(
    userId: string,
    {
        now = new Date(),
        accounts,
        activity,
        sources = DATABASE_SOURCES,
    }: { now?: Date; accounts?: JournalAccount[]; activity?: ActivityRow[]; sources?: TradeJournalLoaders } = {},
): Promise<TradeJournal> {
    const [accountRows, rows, orders, decisions] = await Promise.all([
        accounts ?? sources.loadAccounts(userId),
        activity ?? sources.loadActivity(userId),
        sources.loadOrders(userId),
        sources.loadDecisions(userId),
    ]);
    const { trades, leftOut } = await loadClosedTrades(rows, sources.loadCloses, now);
    const netWorth = accountRows.reduce(
        (sum, account) => sum + (account.cashBalance || 0) + account.holdings.reduce((s, h) => s + valueHolding(h).marketValue, 0),
        0,
    );
    return {
        entries: tradeJournal(trades, { accounts: accountRows, orders, decisions }),
        leftOut,
        netWorth: Math.round(netWorth * 100) / 100,
    };
}

export interface LoadedTradeJournal {
    /** Null without a database: there are no trades to read. */
    journal: TradeJournal | null;
    /** A configured database failed to answer: the page says so instead of showing no trades. */
    unavailable: boolean;
}

/** The trade journal for a page: none without a database, the outage when it fails. */
export async function loadTradeJournalForPage(
    userId: string,
    { databaseConfigured = isDatabaseConfigured(), ...options }: Parameters<typeof loadTradeJournal>[1] & { databaseConfigured?: boolean } = {},
): Promise<LoadedTradeJournal> {
    if (!databaseConfigured) return { journal: null, unavailable: false };
    try {
        return { journal: await loadTradeJournal(userId, options), unavailable: false };
    } catch (error) {
        // Logged during a render, so an AggregateError can't go to the console as is.
        console.error("Trade journal fetch failed.", loggableError(error));
        return { journal: null, unavailable: true };
    }
}
