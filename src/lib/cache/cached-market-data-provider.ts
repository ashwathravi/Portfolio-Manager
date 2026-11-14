/**
 * CachedMarketDataProvider — decorator that wraps any MarketDataProvider and
 * transparently adds caching in front of every call.
 *
 * TTL rules (from spec AR-47):
 *   Quotes        →  30 seconds
 *   Historical    →  24 hours; 10 minutes while the answer doesn't reach
 *                    the last completed session yet (not published, or empty)
 *   Fundamentals  →  24 hours
 *   Search        →   5 minutes
 *
 * Key format: `{type}:{symbol}` — e.g. `quote:AAPL`. History also names the
 * last completed session its range ends at (x22), e.g.
 * `history:AAPL:1D:2026-11-13`, so a new session is a new answer.
 *
 * The cache backend is injected via the CacheProvider interface so it can be
 * swapped (InMemoryCache → Redis, etc.) without touching this class.
 *
 * Linear: AR-47
 */

import type {
  Fundamentals,
  MarketDataProvider,
  OHLC,
  Quote,
  SymbolResult,
} from '@/types/market-data';

import { getEasternParts, lastCompletedSession } from '@/lib/markets/market-hours';

import type { CacheProvider } from './cache-provider';

// ---------------------------------------------------------------------------
// TTL constants (seconds)
// ---------------------------------------------------------------------------

const TTL_QUOTE = 30;
const TTL_HISTORICAL = 24 * 60 * 60; // 24 hours
/**
 * History whose newest bar is older than the last completed session: the
 * nightly ingest stores a session's bars after the close (x09), as Massive
 * publishes them some time after it, so it is asked for again soon (the
 * adapter's quotes wait as long for an unpublished day).
 */
const TTL_HISTORICAL_PENDING = 10 * 60; // 10 minutes
const TTL_FUNDAMENTALS = 24 * 60 * 60; // 24 hours
const TTL_SEARCH = 5 * 60; // 5 minutes

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CachedMarketDataProviderOptions {
  /** Override the default TTLs (values in seconds). */
  ttl?: {
    quote?: number;
    historical?: number;
    /** History that doesn't reach the last completed session yet. */
    historicalPending?: number;
    fundamentals?: number;
    search?: number;
  };
  /** Clock that picks the last completed session for history keys. Default: the system clock */
  now?: () => Date;
}

/** Whether the newest of `bars` is `session`'s (or later), in Eastern dates. */
function reachesSession(bars: readonly OHLC[], session: string): boolean {
  const newest = bars.at(-1);
  if (!newest) return false;
  const time = new Date(newest.timestamp);
  return !Number.isNaN(time.getTime()) && getEasternParts(time).date >= session;
}

// ---------------------------------------------------------------------------
// Decorator
// ---------------------------------------------------------------------------

export class CachedMarketDataProvider implements MarketDataProvider {
  private readonly inner: MarketDataProvider;
  private readonly cache: CacheProvider;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly ttlQuote: number;
  private readonly ttlHistorical: number;
  private readonly ttlHistoricalPending: number;
  private readonly ttlFundamentals: number;
  private readonly ttlSearch: number;
  private readonly now: () => Date;

  constructor(
    inner: MarketDataProvider,
    cache: CacheProvider,
    options: CachedMarketDataProviderOptions = {},
  ) {
    this.inner = inner;
    this.cache = cache;
    this.ttlQuote = options.ttl?.quote ?? TTL_QUOTE;
    this.ttlHistorical = options.ttl?.historical ?? TTL_HISTORICAL;
    this.ttlHistoricalPending = Math.min(this.ttlHistorical, options.ttl?.historicalPending ?? TTL_HISTORICAL_PENDING);
    this.ttlFundamentals = options.ttl?.fundamentals ?? TTL_FUNDAMENTALS;
    this.ttlSearch = options.ttl?.search ?? TTL_SEARCH;
    this.now = options.now ?? (() => new Date());
  }

  // -----------------------------------------------------------------------
  // MarketDataProvider implementation
  // -----------------------------------------------------------------------

  async getQuote(symbol: string): Promise<Quote> {
    const key = `quote:${symbol.toUpperCase()}`;
    const quote = await this.getOrFetch<Quote | undefined>(key, this.ttlQuote, () => this.inner.getQuote(symbol));
    // A batch already in flight for this symbol can come back without it;
    // the provider's own answer (or error) for the symbol is the right one.
    return quote ?? this.inner.getQuote(symbol);
  }

  async getBatchQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    const resultsByKey = new Map<string, Quote>();
    const pending: Promise<void>[] = [];
    const misses: string[] = [];
    const seenMisses = new Set<string>();
    /** Symbols whose shared in-flight request failed; this batch asks again. */
    const retries: string[] = [];

    // Check cache for each symbol individually
    for (const symbol of symbols) {
      const key = `quote:${symbol.toUpperCase()}`;
      const cached = this.cache.get<Quote>(key);
      if (cached !== undefined) {
        resultsByKey.set(key, cached);
        continue;
      }

      const existing = this.inflight.get(key) as Promise<Quote | undefined> | undefined;
      if (existing) {
        // A single-quote request for an unpriced symbol rejects; sharing it
        // must not cost this batch its other quotes. The symbol is asked for
        // again in this batch's own terms (left out when there's no price).
        pending.push(existing.then(
          (quote) => {
            if (quote) resultsByKey.set(key, quote);
          },
          () => {
            retries.push(symbol);
          },
        ));
        continue;
      }

      if (!seenMisses.has(key)) {
        seenMisses.add(key);
        misses.push(symbol);
      }
    }

    // Fetch only the misses in a single batch call. A symbol the provider
    // has no price for is left out of the result, not an error: one fund or
    // crypto ticker must not cost every other symbol its quote.
    if (misses.length > 0) {
      const batch = this.inner.getBatchQuotes(misses).then((fetched) => {
        const quoteMap = new Map<string, Quote>();
        for (const quote of fetched) {
          const key = `quote:${quote.symbol.toUpperCase()}`;
          this.cache.set(key, quote, this.ttlQuote);
          quoteMap.set(key, quote);
        }
        return quoteMap;
      });

      for (const symbol of misses) {
        const key = `quote:${symbol.toUpperCase()}`;
        const quotePromise = batch.then((quoteMap) => quoteMap.get(key));
        const trackedPromise = quotePromise.finally(() => {
          if (this.inflight.get(key) === trackedPromise) this.inflight.delete(key);
        });
        this.inflight.set(key, trackedPromise);
        pending.push(trackedPromise.then((quote) => {
          if (quote) resultsByKey.set(key, quote);
        }));
      }
    }

    await Promise.all(pending);
    if (retries.length > 0) {
      for (const quote of await this.inner.getBatchQuotes(retries)) {
        const key = `quote:${quote.symbol.toUpperCase()}`;
        this.cache.set(key, quote, this.ttlQuote);
        resultsByKey.set(key, quote);
      }
    }
    return symbols
      .map((symbol) => resultsByKey.get(`quote:${symbol.toUpperCase()}`))
      .filter((quote): quote is Quote => quote !== undefined);
  }

  /**
   * Every range ends at the last completed session (x22: 1D and 5D are the
   * last sessions, day ranges end today), so the key names that session: once
   * a newer one closes the range is asked for again, rather than answered
   * with the session before for the rest of a day. Until its bar is
   * published the answer is kept for minutes only.
   */
  async getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
    const session = lastCompletedSession(this.now());
    const key = `history:${symbol.toUpperCase()}:${range.toUpperCase()}:${session}`;
    return this.getOrFetch(
      key,
      (bars) => (reachesSession(bars, session) ? this.ttlHistorical : this.ttlHistoricalPending),
      () => this.inner.getHistoricalPrices(symbol, range),
    );
  }

  async getFundamentals(symbol: string): Promise<Fundamentals> {
    const key = `fundamentals:${symbol.toUpperCase()}`;
    return this.getOrFetch(key, this.ttlFundamentals, () => this.inner.getFundamentals(symbol));
  }

  async searchSymbol(query: string): Promise<SymbolResult[]> {
    const key = `search:${query.trim().toLowerCase()}`;
    return this.getOrFetch(key, this.ttlSearch, () => this.inner.searchSymbol(query));
  }

  private getOrFetch<T>(key: string, ttlSeconds: number | ((result: T) => number), load: () => Promise<T>): Promise<T> {
    const cached = this.cache.get<T>(key);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = load()
      .then((result) => {
        this.cache.set(key, result, typeof ttlSeconds === 'function' ? ttlSeconds(result) : ttlSeconds);
        return result;
      })
      .finally(() => {
        if (this.inflight.get(key) === pending) this.inflight.delete(key);
      });
    this.inflight.set(key, pending);
    return pending;
  }
}
