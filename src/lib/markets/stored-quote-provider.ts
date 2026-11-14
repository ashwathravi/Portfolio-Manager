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
 * History comes from the same store (x09): the daily bars the ingest keeps,
 * two years of them for every held, watched or benchmark symbol. Only a
 * symbol with no stored bar in a range's window asks the reference provider
 * (getHistoricalPrices says why that path stays).
 *
 * Fundamentals still go to the reference provider. So does search, but only
 * without a database: with one, the search route reads the symbol directory
 * instead (symbol-directory.ts, launch item i35).
 */

import { usableDatabaseUrl } from '@/db/connection-options';
import { MarketDataNotConfiguredError, QuoteUnavailableError } from '@/lib/providers/errors';
import { rangeToDates } from '@/lib/providers/polygon-massive-adapter';
import type { Fundamentals, MarketDataProvider, OHLC, Quote, SymbolResult } from '@/types/market-data';

import { easternDateTime, getMarketDay } from './market-hours';
import {
  getBars,
  getRecentCloses,
  normalizeSymbols,
  trackRequestedSecurities,
  type LatestClose,
  type PriceBarInput,
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
  /** A symbol's stored daily bars from `from` through `to` (Eastern dates, inclusive), oldest first. */
  bars(symbol: string, from: string, to: string): Promise<PriceBarInput[]>;
}

const DATABASE_QUOTE_STORE: QuoteStore = {
  configured: () => Boolean(usableDatabaseUrl(process.env.DATABASE_URL)),
  recentCloses: (symbols) => getRecentCloses(symbols, 2),
  track: (symbols) => trackRequestedSecurities(symbols),
  bars: (symbol, from, to) => getBars(symbol, from, to),
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
   * The reference provider (Massive) is asked only when the store has no bar
   * for the symbol in the window. That path stays for symbols the nightly
   * ingest doesn't price yet: a thesis on a ticker nobody holds or watches,
   * or a holding added since the last run, which would otherwise chart
   * nothing until a night has passed. It is the adapter's own path, as
   * before: it takes a call from the five-a-minute budget shared with the
   * ingest (massive-quota.ts), so a spent budget answers 429 and the page
   * shows a dash, and the cache in front keeps each answer. Without a
   * database it is the only source, also as before. A store that fails to
   * answer is an error, not a reason to ask Massive: during an outage every
   * chart on every page would otherwise spend the budget.
   */
  async getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
    if (!this.store.configured()) return this.reference.getHistoricalPrices(symbol, range);

    const { from, to, sessions } = rangeToDates(range, new Date(this.now()));
    const [wanted] = normalizeSymbols([symbol]);
    const stored = wanted ? await this.store.bars(wanted, from, to) : [];
    // Oldest first: a session range keeps its newest sessions.
    const bars = sessions === undefined ? stored : stored.slice(-sessions);
    if (bars.length === 0) return this.reference.getHistoricalPrices(symbol, range);
    return bars.map(ohlcFromBar);
  }

  getFundamentals(symbol: string): Promise<Fundamentals> {
    return this.reference.getFundamentals(symbol);
  }

  searchSymbol(query: string): Promise<SymbolResult[]> {
    return this.reference.searchSymbol(query);
  }
}
