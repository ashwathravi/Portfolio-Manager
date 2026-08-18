/**
 * PortfolioValuationEngine — standalone, robust valuation computation.
 *
 * Responsibilities:
 * 1. Fetch holdings from DB by portfolioId
 * 2. Batch-fetch current prices via MarketDataService (cache-first)
 * 3. Compute per-holding and aggregate valuation metrics
 * 4. Handle edge cases: missing prices, zero-quantity, empty portfolios
 * 5. Chunk large symbol lists to avoid URL-length limits
 *
 * Linear: AR-49
 */

import {
  buildOwnedPortfolioHoldingsQuery,
  buildOwnedPortfolioQuery,
} from '@/lib/portfolio-repository';
import type { MarketDataProvider, Quote } from '@/types/market-data';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface HoldingValuation {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  gainLoss: number;
  gainLossPercent: number;
}

export interface PortfolioValuation {
  portfolioId: string;
  totalValue: number;
  totalCost: number;
  gainLoss: number;
  gainLossPercent: number;
  holdings: HoldingValuation[];
  valuedAt: number; // epoch ms
  errors: string[]; // symbols that failed to price
}

export class PortfolioAccessError extends Error {
  constructor(message = 'Portfolio not found') {
    super(message);
    this.name = 'PortfolioAccessError';
  }
}

export interface PortfolioValuationOptions {
  userId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum symbols per single getBatchQuotes call.
 * Keeps URL length well under typical limits (~2000 chars) and avoids
 * overwhelming the provider in a single request.
 */
const BATCH_CHUNK_SIZE = 75;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class PortfolioValuationEngine {
  constructor(private readonly provider: MarketDataProvider) {}

  /**
   * Compute the live valuation of every holding in a portfolio.
   */
  async value(
    portfolioId: string,
    options: PortfolioValuationOptions,
  ): Promise<PortfolioValuation> {
    const valuedAt = Date.now();

    if (!options.userId) {
      throw new PortfolioAccessError('Portfolio user scope is required');
    }

    const [allowedPortfolio] = await buildOwnedPortfolioQuery(options.userId, portfolioId);

    if (!allowedPortfolio) {
      throw new PortfolioAccessError();
    }

    // 1. Fetch holdings from DB
    const rows = await buildOwnedPortfolioHoldingsQuery(options.userId, portfolioId);

    // Early return for empty portfolio
    if (rows.length === 0) {
      return {
        portfolioId,
        totalValue: 0,
        totalCost: 0,
        gainLoss: 0,
        gainLossPercent: 0,
        holdings: [],
        valuedAt,
        errors: [],
      };
    }

    // Filter out zero-quantity ghost holdings
    const activeRows = rows.filter((r) => {
      const qty = Number(r.quantity);
      return qty !== 0 && !Number.isNaN(qty);
    });

    if (activeRows.length === 0) {
      return {
        portfolioId,
        totalValue: 0,
        totalCost: 0,
        gainLoss: 0,
        gainLossPercent: 0,
        holdings: [],
        valuedAt,
        errors: [],
      };
    }

    // 2. Deduplicate symbols
    const uniqueSymbols = [
      ...new Set(activeRows.map((h) => h.symbol.toUpperCase())),
    ];

    // 3. Batch-fetch prices (chunked for large portfolios)
    const { priceMap, errors } = await this.fetchPricesInChunks(uniqueSymbols);

    // 4. Compute per-holding valuations
    let totalValue = 0;
    let totalCost = 0;

    const holdingValuations: HoldingValuation[] = activeRows.map((row) => {
      const qty = Number(row.quantity);
      const avg = Number(row.avgCost);
      const upperSymbol = row.symbol.toUpperCase();
      const currentPrice = priceMap.get(upperSymbol) ?? 0;

      // If we have no price data for this symbol, record it as an error
      // (unless it was already recorded during fetch)
      if (!priceMap.has(upperSymbol) && !errors.includes(row.symbol)) {
        errors.push(row.symbol);
      }

      const marketValue = qty * currentPrice;
      const costBasis = qty * avg;
      const gainLoss = marketValue - costBasis;
      const gainLossPercent =
        costBasis !== 0 ? (gainLoss / costBasis) * 100 : 0;

      totalValue += marketValue;
      totalCost += costBasis;

      return {
        symbol: row.symbol,
        name: row.name,
        quantity: qty,
        avgCost: avg,
        currentPrice,
        marketValue,
        costBasis,
        gainLoss,
        gainLossPercent,
      };
    });

    const gainLoss = totalValue - totalCost;
    const gainLossPercent =
      totalCost !== 0 ? (gainLoss / totalCost) * 100 : 0;

    return {
      portfolioId,
      totalValue,
      totalCost,
      gainLoss,
      gainLossPercent,
      holdings: holdingValuations,
      valuedAt,
      errors,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Fetch prices for a list of symbols, chunking into batches of
   * BATCH_CHUNK_SIZE to avoid URL-length limits and reduce blast radius
   * if one chunk fails.
   *
   * Individual symbol failures are captured in the errors array rather
   * than rejecting the entire valuation.
   */
  private async fetchPricesInChunks(
    symbols: string[],
  ): Promise<{ priceMap: Map<string, number>; errors: string[] }> {
    const priceMap = new Map<string, number>();
    const errors: string[] = [];

    // Build chunks
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += BATCH_CHUNK_SIZE) {
      chunks.push(symbols.slice(i, i + BATCH_CHUNK_SIZE));
    }

    // Fetch all chunks concurrently
    const results = await Promise.allSettled(
      chunks.map((chunk) => this.provider.getBatchQuotes(chunk)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        for (const quote of result.value) {
          priceMap.set(quote.symbol.toUpperCase(), quote.price);
        }
        // Check if any symbols in this chunk didn't get a quote back
        const returnedSymbols = new Set(
          result.value.map((q: Quote) => q.symbol.toUpperCase()),
        );
        for (const sym of chunks[i]) {
          if (!returnedSymbols.has(sym.toUpperCase())) {
            errors.push(sym);
          }
        }
      } else {
        // Entire chunk failed — record all symbols as errors
        errors.push(...chunks[i]);
      }
    }

    return { priceMap, errors };
  }
}
