/**
 * Provider-agnostic market data models.
 *
 * These interfaces are the canonical shapes used throughout the app.
 * Provider adapters (Polygon, etc.) normalize API responses into these
 * models so no provider-specific shapes leak past the adapter boundary.
 */

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  /** ISO-8601 timestamp of the quote */
  timestamp: string;
  /** Whether the quote reflects real-time or delayed data */
  isRealtime: boolean;
}

// ---------------------------------------------------------------------------
// OHLC (candlestick / aggregate bar)
// ---------------------------------------------------------------------------

export interface OHLC {
  /** ISO-8601 timestamp for the start of the bar */
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

export interface Fundamentals {
  symbol: string;
  name?: string;
  description?: string;
  marketCap?: number;
  primaryExchange?: string;
  /** Security type, e.g. "CS" (common stock), "ETF", etc. */
  type?: string;
  sector?: string;
  industry?: string;
  website?: string;
}

// ---------------------------------------------------------------------------
// Symbol search result
// ---------------------------------------------------------------------------

export interface SymbolResult {
  symbol: string;
  name: string;
  type: string;
  primaryExchange: string;
  /** Whether the ticker is currently active */
  active: boolean;
}

// ---------------------------------------------------------------------------
// MarketDataProvider — the abstraction every adapter must implement
// ---------------------------------------------------------------------------

export interface MarketDataProvider {
  /** Fetch a single real-time (or delayed) quote. */
  getQuote(symbol: string): Promise<Quote>;

  /** Fetch quotes for multiple symbols in one call. */
  getBatchQuotes(symbols: string[]): Promise<Quote[]>;

  /**
   * Fetch historical OHLC bars.
   * @param range  Human-readable range key, e.g. "1M", "3M", "1Y", "5Y".
   *               The adapter is responsible for translating this into
   *               provider-specific date math.
   */
  getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]>;

  /** Fetch fundamental / reference data for a symbol. */
  getFundamentals(symbol: string): Promise<Fundamentals>;

  /** Search for symbols matching a free-text query. */
  searchSymbol(query: string): Promise<SymbolResult[]>;
}
