/**
 * MarketDataService — single orchestration layer between controllers and
 * market-data providers.
 *
 * Controllers and server pages never call providers directly; they go
 * through this service, so the whole app reads one source of prices
 * (launch item i30). The underlying provider is swappable via constructor
 * injection. By default quotes are read from the Postgres price store that
 * the nightly ingest fills (StoredQuoteProvider), so serving a page never
 * spends the free plan's five Massive calls a minute; history, fundamentals
 * and search go to the PolygonMassiveAdapter. Construction never throws:
 * without a database (quotes) or POLYGON_API_KEY (the rest) requests reject
 * with MarketDataNotConfiguredError, which pages answer with stored prices
 * ({@link loadQuotes}) and routes with a 503.
 *
 * Portfolio valuation is delegated to PortfolioValuationEngine (AR-49).
 *
 * Linear: AR-45
 */

import {
  CachedMarketDataProvider,
  InMemoryCache,
} from '@/lib/cache';
import { MarketDataNotConfiguredError } from '@/lib/providers/errors';
import { PolygonMassiveAdapter } from '@/lib/providers/polygon-massive-adapter';
import { getMassiveQuota } from '@/lib/providers/massive-quota';
import { StoredQuoteProvider } from '@/lib/markets/stored-quote-provider';
import type {
  Fundamentals,
  MarketDataProvider,
  OHLC,
  Quote,
  SymbolResult,
} from '@/types/market-data';

import {
  PortfolioValuationEngine,
  type PortfolioValuation,
  type PortfolioValuationOptions,
  type HoldingValuation,
} from './portfolio-valuation-engine';

// Re-export valuation types so existing consumers don't break
export type { PortfolioValuation, HoldingValuation };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MarketDataService {
  private readonly provider: MarketDataProvider;
  private readonly valuationEngine: PortfolioValuationEngine;

  constructor(provider?: MarketDataProvider) {
    this.provider =
      provider ??
      new CachedMarketDataProvider(
        // Quotes come from the price store; Massive serves history,
        // fundamentals and search, within the budget it shares with the
        // nightly ingest.
        new StoredQuoteProvider(new PolygonMassiveAdapter(undefined, undefined, { quota: getMassiveQuota() })),
        new InMemoryCache({ sweepIntervalMs: 60_000 }),
      );
    this.valuationEngine = new PortfolioValuationEngine(this.provider);
  }

  // -----------------------------------------------------------------------
  // Pass-through provider methods
  // -----------------------------------------------------------------------

  getQuote(symbol: string): Promise<Quote> {
    return this.provider.getQuote(symbol);
  }

  getBatchQuotes(symbols: string[]): Promise<Quote[]> {
    return this.provider.getBatchQuotes(symbols);
  }

  /**
   * Quotes keyed by uppercase symbol. Blank symbols are dropped, and a
   * symbol the provider has no price for is simply absent.
   */
  async getQuotes(symbols: Iterable<string>): Promise<Record<string, Quote>> {
    const unique = [...new Set([...symbols].map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (unique.length === 0) return {};

    const quotes: Record<string, Quote> = {};
    for (const quote of await this.provider.getBatchQuotes(unique)) {
      quotes[quote.symbol.toUpperCase()] = quote;
    }
    return quotes;
  }

  getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
    return this.provider.getHistoricalPrices(symbol, range);
  }

  getFundamentals(symbol: string): Promise<Fundamentals> {
    return this.provider.getFundamentals(symbol);
  }

  searchSymbol(query: string): Promise<SymbolResult[]> {
    return this.provider.searchSymbol(query);
  }

  // -----------------------------------------------------------------------
  // Composite: DB + market data
  // -----------------------------------------------------------------------

  /**
   * Compute the live valuation of every holding in a portfolio.
   *
   * Delegates to PortfolioValuationEngine (AR-49) which handles batching,
   * chunking for large portfolios, and graceful error handling.
   */
  async getPortfolioValue(
    portfolioId: string,
    options: PortfolioValuationOptions,
  ): Promise<PortfolioValuation> {
    return this.valuationEngine.value(portfolioId, options);
  }
}

// ---------------------------------------------------------------------------
// Singleton factory — default export for easy controller imports
// ---------------------------------------------------------------------------

let _instance: MarketDataService | null = null;

/**
 * Return a singleton MarketDataService backed by the default provider.
 * Controllers can import this instead of constructing their own instance.
 */
export function getMarketDataService(): MarketDataService {
  if (!_instance) {
    _instance = new MarketDataService();
  }
  return _instance;
}

// ---------------------------------------------------------------------------
// Page helper
// ---------------------------------------------------------------------------

/**
 * Quotes for a server page's first paint, keyed by uppercase symbol. Never
 * throws: on any failure it returns `{}` and the page falls back to the
 * prices it stored. No key configured is the normal local and E2E state, so
 * it logs nothing; anything else gets one line, without a stack trace.
 */
export async function loadQuotes(
  symbols: Iterable<string>,
  service?: MarketDataService,
): Promise<Record<string, Quote>> {
  const list = [...symbols];
  if (list.length === 0) return {};
  try {
    return await (service ?? getMarketDataService()).getQuotes(list);
  } catch (err) {
    if (!(err instanceof MarketDataNotConfiguredError)) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`Market data unavailable, showing stored prices: ${reason}`);
    }
    return {};
  }
}
