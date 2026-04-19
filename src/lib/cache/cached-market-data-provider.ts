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
    const cached = this.cache.get<Quote>(key);
    if (cached) return cached;

    const result = await this.inner.getQuote(symbol);
    this.cache.set(key, result, this.ttlQuote);
    return result;
  }

  async getBatchQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    const results: Quote[] = [];
    const misses: string[] = [];

    // Check cache for each symbol individually
    for (const symbol of symbols) {
      const key = `quote:${symbol.toUpperCase()}`;
      const cached = this.cache.get<Quote>(key);
      if (cached) {
        results.push(cached);
      } else {
        misses.push(symbol);
      }
    }

    // Fetch only the misses in a single batch call
    if (misses.length > 0) {
      const fetched = await this.inner.getBatchQuotes(misses);
      for (const quote of fetched) {
        const key = `quote:${quote.symbol.toUpperCase()}`;
        this.cache.set(key, quote, this.ttlQuote);
        results.push(quote);
      }
    }

    return results;
  }

  async getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
    const key = `history:${symbol.toUpperCase()}:${range.toUpperCase()}`;
    const cached = this.cache.get<OHLC[]>(key);
    if (cached) return cached;

    const result = await this.inner.getHistoricalPrices(symbol, range);
    this.cache.set(key, result, this.ttlHistorical);
    return result;
  }

  async getFundamentals(symbol: string): Promise<Fundamentals> {
    const key = `fundamentals:${symbol.toUpperCase()}`;
    const cached = this.cache.get<Fundamentals>(key);
    if (cached) return cached;

    const result = await this.inner.getFundamentals(symbol);
    this.cache.set(key, result, this.ttlFundamentals);
    return result;
  }

  async searchSymbol(query: string): Promise<SymbolResult[]> {
    const key = `search:${query.trim().toLowerCase()}`;
    const cached = this.cache.get<SymbolResult[]>(key);
    if (cached) return cached;

    const result = await this.inner.searchSymbol(query);
    this.cache.set(key, result, this.ttlSearch);
    return result;
  }
}
