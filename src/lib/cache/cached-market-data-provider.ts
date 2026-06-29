/**
 * CachedMarketDataProvider — decorator that wraps any MarketDataProvider and
 * transparently adds caching in front of every call.
 *
 * TTL rules (from spec AR-47):
 *   Quotes        →  30 seconds
 *   Historical    →  24 hours
 *   Fundamentals  →  24 hours
 *   Search        →   5 minutes
 *
 * Key format: `{type}:{symbol}` — e.g. `quote:AAPL`, `history:AAPL:1M`
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

import type { CacheProvider } from './cache-provider';

// ---------------------------------------------------------------------------
// TTL constants (seconds)
// ---------------------------------------------------------------------------

const TTL_QUOTE = 30;
const TTL_HISTORICAL = 24 * 60 * 60; // 24 hours
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
    fundamentals?: number;
    search?: number;
  };
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
  private readonly ttlFundamentals: number;
  private readonly ttlSearch: number;

  constructor(
    inner: MarketDataProvider,
    cache: CacheProvider,
    options: CachedMarketDataProviderOptions = {},
  ) {
    this.inner = inner;
    this.cache = cache;
    this.ttlQuote = options.ttl?.quote ?? TTL_QUOTE;
    this.ttlHistorical = options.ttl?.historical ?? TTL_HISTORICAL;
    this.ttlFundamentals = options.ttl?.fundamentals ?? TTL_FUNDAMENTALS;
    this.ttlSearch = options.ttl?.search ?? TTL_SEARCH;
  }

  // -----------------------------------------------------------------------
  // MarketDataProvider implementation
  // -----------------------------------------------------------------------

  async getQuote(symbol: string): Promise<Quote> {
    const key = `quote:${symbol.toUpperCase()}`;
    return this.getOrFetch(key, this.ttlQuote, () => this.inner.getQuote(symbol));
  }

  async getBatchQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    const resultsByKey = new Map<string, Quote>();
    const pending: Promise<void>[] = [];
    const misses: string[] = [];
    const seenMisses = new Set<string>();

    // Check cache for each symbol individually
    for (const symbol of symbols) {
      const key = `quote:${symbol.toUpperCase()}`;
      const cached = this.cache.get<Quote>(key);
      if (cached !== undefined) {
        resultsByKey.set(key, cached);
        continue;
      }

      const existing = this.inflight.get(key) as Promise<Quote> | undefined;
      if (existing) {
        pending.push(existing.then((quote) => {
          resultsByKey.set(key, quote);
        }));
        continue;
      }

      if (!seenMisses.has(key)) {
        seenMisses.add(key);
        misses.push(symbol);
      }
    }

    // Fetch only the misses in a single batch call
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
        const quotePromise = batch.then((quoteMap) => {
          const quote = quoteMap.get(key);
          if (!quote) throw new Error(`No quote returned for ${symbol.toUpperCase()}`);
          return quote;
        });
        const trackedPromise = quotePromise.finally(() => {
          if (this.inflight.get(key) === trackedPromise) this.inflight.delete(key);
        });
        this.inflight.set(key, trackedPromise);
        pending.push(trackedPromise.then((quote) => {
          resultsByKey.set(key, quote);
        }));
      }
    }

    await Promise.all(pending);
    return symbols
      .map((symbol) => resultsByKey.get(`quote:${symbol.toUpperCase()}`))
      .filter((quote): quote is Quote => quote !== undefined);
  }

  async getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
    const key = `history:${symbol.toUpperCase()}:${range.toUpperCase()}`;
    return this.getOrFetch(key, this.ttlHistorical, () => this.inner.getHistoricalPrices(symbol, range));
  }

  async getFundamentals(symbol: string): Promise<Fundamentals> {
    const key = `fundamentals:${symbol.toUpperCase()}`;
    return this.getOrFetch(key, this.ttlFundamentals, () => this.inner.getFundamentals(symbol));
  }

  async searchSymbol(query: string): Promise<SymbolResult[]> {
    const key = `search:${query.trim().toLowerCase()}`;
    return this.getOrFetch(key, this.ttlSearch, () => this.inner.searchSymbol(query));
  }

  private getOrFetch<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cached = this.cache.get<T>(key);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = load()
      .then((result) => {
        this.cache.set(key, result, ttlSeconds);
        return result;
      })
      .finally(() => {
        if (this.inflight.get(key) === pending) this.inflight.delete(key);
      });
    this.inflight.set(key, pending);
    return pending;
  }
}
