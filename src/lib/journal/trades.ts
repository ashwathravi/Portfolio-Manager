/**
 * The user's trade journal (launch item i51): their closed trades, from
 * their transactions (src/lib/portfolio/closed-trades.ts), each with what
 * they recorded about the buy that opened it. Two places hold that, and
 * this is where they meet:
 *
 * - Trade: the rationale (mood, setup, conviction, thesis, why) captured
 *   for an order the user drafted and then marked placed, with any risk
 *   policy exceptions they accepted for it.
 * - Research › Journal: an entry decision they wrote for the ticker.
 *
 * Either counts when it's for the same ticker and dated within
 * NOTE_LOOKBACK_DAYS before the opening buy (an order also in the same
 * account); the latest one wins. Nothing is made up: a trade nobody wrote
 * about carries neither, and since transactions keep dates, not times,
 * every entry is date-only.
 */

import { getEasternParts } from '@/lib/markets/market-hours';
import type { ClosedTrade } from '@/lib/portfolio/closed-trades';
import type { JournalEntry as DecisionEntry } from '@/lib/research/journal';
import type { Order } from '@/types/execution';
import type { JournalDecisionNote, JournalEntry } from '@/types/trade';

const DAY_MS = 86_400_000;

/** A decision-journal entry, as stored (no thesis is null) or as the browser keeps it. */
type DecisionSource = Pick<DecisionEntry, 'id' | 'date' | 'type' | 'ticker' | 'decision' | 'rationale'> & { thesisId?: string | null };

/** The user's trade journal, as the server loads it for a page (`./server.ts`). */
export interface TradeJournal {
    /** Closed trades, newest first. */
    entries: JournalEntry[];
    /** Tickers left out: one of their trades is off today's share scale (a split, likely). */
    leftOut: string[];
    /** Holdings at their stored prices plus cash: what the weekly review measures P&L against. */
    netWorth: number;
}

/** How many days before the opening buy an order or decision can be for it. */
export const NOTE_LOOKBACK_DAYS = 7;

export interface TradeJournalSources {
    /** The user's accounts: an order names its account by ID, a trade by name. */
    accounts: readonly { id: string; name: string }[];
    /** The user's order plans; only placed equity buys are read. */
    orders: readonly Order[];
    /** The user's decision journal; only entry decisions are read. */
    decisions: readonly DecisionSource[];
}

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

function minusDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** Whether `day` (YYYY-MM-DD) is on or up to NOTE_LOOKBACK_DAYS before `opened`. */
function forOpening(day: string, opened: string): boolean {
    return day <= opened && day >= minusDays(opened, NOTE_LOOKBACK_DAYS);
}

/** Example decision-journal entries (Research's examples) aren't the user's. */
const isExample = (entry: Pick<DecisionSource, 'id'>) => entry.id.startsWith('seed-');

/** The user's closed trades as journal entries, newest first, as `closed` is. */
export function tradeJournal(closed: readonly ClosedTrade[], sources: TradeJournalSources): JournalEntry[] {
    const accountName = new Map(sources.accounts.map((account) => [account.id, account.name]));
    const buys = sources.orders
        .filter((order) => order.status === 'placed' && order.side === 'buy' && order.instrumentType === 'equity')
        .map((order) => ({
            order,
            account: accountName.get(order.portfolioId),
            symbol: order.ticker.toUpperCase(),
            // The day it was drafted, as the market counts days.
            day: getEasternParts(new Date(order.createdAt)).date,
        }))
        .filter((buy) => buy.account !== undefined)
        .sort((a, b) => (a.order.createdAt < b.order.createdAt ? 1 : a.order.createdAt > b.order.createdAt ? -1 : 0));
    const decisions = sources.decisions
        .filter((entry) => entry.type === 'entry' && !isExample(entry))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return closed.map((trade) => {
        const opened = trade.openedAt.slice(0, 10);
        const symbol = trade.symbol.toUpperCase();
        const order = buys.find((buy) => buy.symbol === symbol && buy.account === trade.account && forOpening(buy.day, opened))?.order;
        const decision = decisions.find((entry) => entry.ticker.toUpperCase() === symbol && forOpening(entry.date, opened));
        const exceptions = order?.policy?.exceptions ?? [];

        return {
            id: trade.id,
            ...(order ? { orderId: order.id } : {}),
            ticker: trade.symbol,
            account: trade.account,
            side: 'buy',
            quantity: trade.quantity,
            entryPrice: round(trade.costBasis / trade.quantity, 4),
            exitPrice: round(trade.proceeds / trade.quantity, 4),
            notionalUsd: trade.costBasis,
            realizedPnlUsd: trade.realizedPnl,
            holdingPeriodDays: (Date.parse(trade.closedAt) - Date.parse(trade.openedAt)) / DAY_MS,
            openedAt: trade.openedAt,
            closedAt: trade.closedAt,
            dateOnly: true,
            ...(order?.rationale ? { rationale: order.rationale } : {}),
            ...(decision ? { decision: decisionNote(decision) } : {}),
            ...(exceptions.length > 0 ? { policyExceptions: exceptions } : {}),
        } satisfies JournalEntry;
    });
}

function decisionNote(entry: DecisionSource): JournalDecisionNote {
    return {
        id: entry.id,
        date: entry.date,
        decision: entry.decision,
        rationale: entry.rationale,
        ...(entry.thesisId ? { thesisId: entry.thesisId } : {}),
    };
}

/** What a closed trade's "why" reads as: the rationale from Trade, else the journal's. */
export function tradeReason(entry: Pick<JournalEntry, 'rationale' | 'decision'>): string | null {
    const fromTrade = entry.rationale?.rationale.trim();
    if (fromTrade) return fromTrade;
    const fromJournal = [entry.decision?.decision, entry.decision?.rationale].map((part) => part?.trim()).filter(Boolean);
    return fromJournal.length > 0 ? fromJournal.join(' — ') : null;
}
