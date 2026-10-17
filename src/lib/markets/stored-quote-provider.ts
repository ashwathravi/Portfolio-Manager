/**
 * Quotes from the Postgres price store (launch items i30/i32).
 *
 * Request paths never call Massive for prices: the free plan allows five
 * calls a minute, and on Vercel every cold instance would spend its own.
 * The nightly ingest stores each session's closes once; a quote is the
 * latest stored close and the change since the close before it. A symbol
 * with no stored close yet is left out of the answer and starts being
 * tracked, so the next ingest prices it.
 *
 * History, fundamentals and search still go to the reference provider.
 */

import { usableDatabaseUrl } from '@/db/connection-options';
import { MarketDataNotConfiguredError, QuoteUnavailableError } from '@/lib/providers/errors';
import type { Fundamentals, MarketDataProvider, OHLC, Quote, SymbolResult } from '@/types/market-data';

import { easternDateTime, getMarketDay } from './market-hours';
import { getRecentCloses, normalizeSymbols, trackSecurities, type LatestClose } from './price-store';

const NYSE_CLOSE_MINUTES = 16 * 60;
/** How many tracked symbols an instance remembers before starting over. */
const TRACKED_MEMORY_LIMIT = 2_000;

/** The price store operations quotes need; injectable for tests. */
export interface QuoteStore {
  configured(): boolean;
  /** The latest two closes per symbol, newest first. */
  recentCloses(symbols: string[]): Promise<Map<string, LatestClose[]>>;
  /** Start tracking symbols so the nightly ingest prices them. */
  track(symbols: string[]): Promise<unknown>;
}

const DATABASE_QUOTE_STORE: QuoteStore = {
  configured: () => Boolean(usableDatabaseUrl(process.env.DATABASE_URL)),
  recentCloses: (symbols) => getRecentCloses(symbols, 2),
  track: (symbols) => trackSecurities(symbols),
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

/** A closing quote from a symbol's newest stored closes, or undefined without a positive close. */
export function quoteFromCloses(symbol: string, closes: readonly LatestClose[]): Quote | undefined {
  const [latest, previous] = closes;
  if (!latest || !(latest.close > 0)) return undefined;

  const previousClose = previous && previous.close > 0 ? previous.close : 0;
  const change = previousClose > 0 ? latest.close - previousClose : 0;
  return {
    symbol,
    price: latest.close,
    change,
    changePercent: previousClose > 0 ? (change / previousClose) * 100 : 0,
    timestamp: sessionCloseTime(latest.date),
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

  constructor(
    private readonly reference: MarketDataProvider,
    private readonly store: QuoteStore = DATABASE_QUOTE_STORE,
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
    if (untracked.length > 0) {
      try {
        await this.store.track(untracked);
        if (this.tracked.size + untracked.length > TRACKED_MEMORY_LIMIT) this.tracked.clear();
        for (const symbol of untracked) this.tracked.add(symbol);
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

  getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
    return this.reference.getHistoricalPrices(symbol, range);
  }

  getFundamentals(symbol: string): Promise<Fundamentals> {
    return this.reference.getFundamentals(symbol);
  }

  searchSymbol(query: string): Promise<SymbolResult[]> {
    return this.reference.searchSymbol(query);
  }
}
