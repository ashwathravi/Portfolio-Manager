/**
 * MarketDataService — single orchestration layer between controllers and
 * market-data providers.
 *
 * Controllers never call providers directly; they go through this service.
 * The underlying provider is swappable via constructor injection (defaults to
 * PolygonMassiveAdapter).
 *
 * Portfolio valuation is delegated to PortfolioValuationEngine (AR-49).
 *
 * Linear: AR-45
 */

import {
  CachedMarketDataProvider,
  InMemoryCache,
} from '@/lib/cache';
import { PolygonMassiveAdapter } from '@/lib/providers/polygon-massive-adapter';
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
        new PolygonMassiveAdapter(),
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
