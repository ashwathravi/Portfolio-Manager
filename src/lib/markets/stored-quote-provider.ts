/**
 * Quotes from the Postgres price store (launch items i30/i32).
 *
 * Request paths never call Massive for prices: the free plan allows five
 * calls a minute, and on Vercel every cold instance would spend its own.
 * The nightly ingest stores each session's closes once; a quote is the
 * latest stored close and the change since the close before it. A symbol
 * with no stored close yet is left out of the answer and starts being
 * tracked, so the next ingest prices it, while the store is under its
 * limit of tracked securities (REQUESTED_TRACKING_LIMIT).
 *
 * History comes from the same store (x09): the daily bars the ingest keeps.
 * A tracked symbol has two years of them once the ingest's history backfill
 * has reached it, which takes a few nights for a new symbol behind a queue
 * (held symbols and benchmarks first, about a dozen a weekday run). Until
 * then, and for symbols the store doesn't track, a range the stored bars
 * don't cover asks the reference provider (storedHistoryAnswer says when).
 *
 * Fundamentals still go to the reference provider. So does search, but only
 * without a database: with one, the search route reads the symbol directory
 * instead (symbol-directory.ts, launch item i35).
 */

import { usableDatabaseUrl } from '@/db/connection-options';
import { MarketDataNotConfiguredError, QuoteUnavailableError } from '@/lib/providers/errors';
import { rangeToDates, type HistoryWindow } from '@/lib/providers/polygon-massive-adapter';
import type { Fundamentals, MarketDataProvider, OHLC, Quote, SymbolResult } from '@/types/market-data';

import { easternDateTime, getMarketDay, nextTradingDay } from './market-hours';
import {
  getRecentCloses,
  getStoredHistory,
  normalizeSymbols,
  trackRequestedSecurities,
  type LatestClose,
  type PriceBarInput,
  type StoredHistory,
} from './price-store';

const NYSE_CLOSE_MINUTES = 16 * 60;
/** How many tracked symbols an instance remembers before starting over. */
const TRACKED_MEMORY_LIMIT = 2_000;
/** With the store full, how long before this instance asks to track anything again. */
export const TRACKING_RETRY_MS = 10 * 60 * 1000;

/** The price store operations quotes and history need; injectable for tests. */
export interface QuoteStore {
  configured(): boolean;
  /** The latest two closes per symbol, newest first. */
  recentCloses(symbols: string[]): Promise<Map<string, LatestClose[]>>;
  /**
   * Start tracking symbols so the nightly ingest prices them, bounded by the
   * store's limit; says which were refused for lack of room.
   */
  track(symbols: string[]): Promise<{ refused: readonly string[] }>;
  /**
   * A symbol's stored daily bars from `from` through `to` (Eastern dates,
   * inclusive), oldest first, with whether it is tracked and its backfill done.
   */
  history(symbol: string, from: string, to: string): Promise<StoredHistory>;
}

const DATABASE_QUOTE_STORE: QuoteStore = {
  configured: () => Boolean(usableDatabaseUrl(process.env.DATABASE_URL)),
  recentCloses: (symbols) => getRecentCloses(symbols, 2),
  track: (symbols) => trackRequestedSecurities(symbols),
  history: (symbol, from, to) => getStoredHistory(symbol, from, to),
};

/** When a session's close happened: 4:00 PM ET, or 1:00 PM on early-close days. */
export function sessionCloseTime(date: string): string {
  try {
    return easternDateTime(date, getMarketDay(date).closeMinutes ?? NYSE_CLOSE_MINUTES).toISOString();
  } catch {
    // Outside the calendar's range: a 4:00 PM EST close is close enough.
    return `${date}T21:00:00.000Z`;
  }
}

/**
 * A stored daily bar in the shape history has always had: Massive's, stamped
 * with midnight New York on its trading date (the bar's start), so a bar
 * reads as its own session wherever the date is taken from it.
 */
export function ohlcFromBar(bar: Pick<PriceBarInput, 'date' | 'open' | 'high' | 'low' | 'close' | 'volume'>): OHLC {
  return {
    timestamp: easternDateTime(bar.date, 0).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

/**
 * A closing quote from a symbol's newest stored closes, or undefined without
 * a positive close. With only one close stored (a newly tracked symbol) the
 * change is unknown, so it is null rather than zero.
 */
export function quoteFromCloses(symbol: string, closes: readonly LatestClose[]): Quote | undefined {
  const [latest, previous] = closes;
  if (!latest || !(latest.close > 0)) return undefined;

  const previousClose = previous && previous.close > 0 ? previous.close : 0;
  const change = previousClose > 0 ? latest.close - previousClose : null;
  return {
    symbol,
    price: latest.close,
    change,
    changePercent: change !== null ? (change / previousClose) * 100 : null,
    timestamp: sessionCloseTime(latest.date),
    kind: 'close',
    isRealtime: false,
  };
}

/** The first trading session on or after `date`; undefined outside the calendar. */
function firstSessionFrom(date: string): string | undefined {
  try {
    return getMarketDay(date).isTradingDay ? date : nextTradingDay(date);
  } catch {
    return undefined;
  }
}

/**
 * The stored bars that answer a history range, or undefined when the store
 * can't answer it and the reference provider (Massive) should.
 *
 * - Not tracked: nothing is stored, so Massive (a thesis ticker nobody holds
 *   or watches, a symbol the tracking limit refused).
 * - Backfill done (historyStart set): the store holds everything Massive had
 *   and the daily files since, so its bars are the answer, however few: a
 *   recent listing has a short history, and a symbol Massive's stocks feed
 *   doesn't price (a mutual fund, a delisted ticker) has none. Asking Massive
 *   again would spend the shared budget on the same nothing.
 * - Backfill pending: the bars are only what the daily files stored since the
 *   symbol was tracked, or since a split cleared its old-scale bars. They
 *   answer a range they cover (a session range's sessions, or a calendar
 *   range from its first session on), never one they don't: a day's bar
 *   charted as a month would read as the month's move.
 */
export function storedHistoryAnswer(stored: StoredHistory, window: HistoryWindow): PriceBarInput[] | undefined {
  if (!stored.tracked) return undefined;
  // Oldest first: a session range keeps its newest sessions.
  const bars = window.sessions === undefined ? stored.bars : stored.bars.slice(-window.sessions);
  if (stored.historyStart !== null) return bars;
  if (window.sessions !== undefined) return bars.length >= window.sessions ? bars : undefined;
  const first = firstSessionFrom(window.from);
  return first !== undefined && bars.length > 0 && bars[0].date <= first ? bars : undefined;
}

export class StoredQuoteProvider implements MarketDataProvider {
  /**
   * Symbols this instance has already asked the store to track. Unpriced
   * symbols are asked for on every refresh (the sidebar polls BTC-USD, which
   * the stock-only ingest never prices), so without this every poll writes.
   */
  private readonly tracked = new Set<string>();
  /** When the store last refused symbols for lack of room, no asks before this. */
  private retryTrackingAt = 0;

  constructor(
    private readonly reference: MarketDataProvider,
    private readonly store: QuoteStore = DATABASE_QUOTE_STORE,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getBatchQuotes(symbols: string[]): Promise<Quote[]> {
    if (!this.store.configured()) throw new MarketDataNotConfiguredError('DATABASE_URL');
    const wanted = normalizeSymbols(symbols);
    if (wanted.length === 0) return [];

    const closes = await this.store.recentCloses(wanted);
    const quotes: Quote[] = [];
    const missing: string[] = [];
    for (const symbol of wanted) {
      const quote = quoteFromCloses(symbol, closes.get(symbol) ?? []);
      if (quote) quotes.push(quote);
      else missing.push(symbol);
    }

    const untracked = missing.filter((symbol) => !this.tracked.has(symbol));
    if (untracked.length > 0 && this.now() >= this.retryTrackingAt) {
      try {
        const { refused } = await this.store.track(untracked);
        const notTracked = new Set(refused);
        if (this.tracked.size + untracked.length > TRACKED_MEMORY_LIMIT) this.tracked.clear();
        for (const symbol of untracked) if (!notTracked.has(symbol)) this.tracked.add(symbol);
        // Refused symbols aren't remembered: they are asked for again once
        // room may have freed up, not on every refresh until then.
        if (notTracked.size > 0) this.retryTrackingAt = this.now() + TRACKING_RETRY_MS;
      } catch (err) {
        // Prices still come back; the symbols are tracked on a later read.
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`Could not start tracking ${untracked.length} symbol(s) for pricing: ${reason}`);
      }
    }
    return quotes;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const [quote] = await this.getBatchQuotes([symbol]);
    if (!quote) throw new QuoteUnavailableError(symbol.trim().toUpperCase());
    return quote;
  }

  /**
   * Daily bars for a history range from the price store (x09), in the
   * range's window (rangeToDates, x22): 1D and 5D the newest one and five
   * stored sessions through the last completed one, the rest calendar days
   * back from today, MAX two years. Sparklines on Holdings and Today and the
   * thesis charts ask for one symbol each, so a page of them is a page of
   * database reads rather than a Massive call apiece.
   *
   * The reference provider (Massive) is asked only when the store can't
   * answer the range (storedHistoryAnswer): a symbol it doesn't track, or
   * one whose backfill hasn't run yet and whose daily-file bars don't cover
   * the window (a holding or watched ticker added in the last few nights, a
   * stock that split). It is the adapter's own path, as before: it takes a
   * call from the five-a-minute budget shared with the ingest
   * (massive-quota.ts), so a spent budget answers 429 and the page shows a
   * dash rather than a shorter line drawn as the whole range, and the cache
   * in front keeps each answer. Without a database it is the only source,
   * also as before. A store that fails to answer is an error, not a reason to
   * ask Massive: during an outage every chart on every page would otherwise
   * spend the budget.
   */
  async getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
    if (!this.store.configured()) return this.reference.getHistoricalPrices(symbol, range);

    const window = rangeToDates(range, new Date(this.now()));
    const [wanted] = normalizeSymbols([symbol]);
    if (!wanted) return this.reference.getHistoricalPrices(symbol, range);
    const bars = storedHistoryAnswer(await this.store.history(wanted, window.from, window.to), window);
    if (bars === undefined) return this.reference.getHistoricalPrices(symbol, range);
    return bars.map(ohlcFromBar);
  }

  getFundamentals(symbol: string): Promise<Fundamentals> {
    return this.reference.getFundamentals(symbol);
  }

  searchSymbol(query: string): Promise<SymbolResult[]> {
    return this.reference.searchSymbol(query);
  }
}
