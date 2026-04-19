/**
 * PolygonMassiveAdapter — MarketDataProvider implementation backed by
 * the Polygon.io (Massive) REST API.
 *
 * Environment variables:
 *   POLYGON_API_KEY  — API key appended to every request
 *   POLYGON_BASE_URL — base URL, defaults to https://api.polygon.io
 */

import type {
  Fundamentals,
  MarketDataProvider,
  OHLC,
  Quote,
  SymbolResult,
} from '@/types/market-data';

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

/** Thrown when Polygon returns a 429 rate-limit response. */
export class PolygonRateLimitError extends Error {
  public readonly retryAfterMs: number;

  constructor(retryAfterMs: number, url: string) {
    super(
      `PolygonMassiveAdapter: Rate limited (429). ` +
        `Retry after ${retryAfterMs}ms — ${url}`,
    );
    this.name = 'PolygonRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Thrown for non-rate-limit HTTP errors from Polygon. */
export class PolygonApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;

  constructor(status: number, statusText: string, url: string) {
    super(
      `PolygonMassiveAdapter: HTTP ${status} ${statusText} — ${url}`,
    );
    this.name = 'PolygonApiError';
    this.status = status;
    this.statusText = statusText;
  }
}

/** Thrown when a request to Polygon times out. */
export class PolygonTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, url: string) {
    super(
      `PolygonMassiveAdapter: Request timed out after ${timeoutMs}ms — ${url}`,
    );
    this.name = 'PolygonTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

// ---------------------------------------------------------------------------
// Polygon-specific response shapes (private — never exported)
// ---------------------------------------------------------------------------

interface PolygonSnapshotTicker {
  ticker: string;
  todaysChange: number;
  todaysChangePerc: number;
  updated: number; // nanosecond unix timestamp
  day?: {
    c: number; // close
    h: number;
    l: number;
    o: number;
    v: number;
    vw: number;
  };
  lastTrade?: {
    p: number;
    t: number; // nanosecond unix timestamp
  };
  prevDay?: {
    c: number;
    h: number;
    l: number;
    o: number;
    v: number;
    vw: number;
  };
}

interface PolygonSnapshotSingleResponse {
  status: string;
  request_id: string;
  ticker?: PolygonSnapshotTicker;
}

interface PolygonSnapshotMultiResponse {
  status: string;
  tickers?: PolygonSnapshotTicker[];
}

interface PolygonAggBar {
  t: number; // millisecond unix timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface PolygonAggsResponse {
  status: string;
  resultsCount?: number;
  results?: PolygonAggBar[];
}

interface PolygonTickerDetail {
  ticker: string;
  name?: string;
  description?: string;
  market_cap?: number;
  primary_exchange?: string;
  type?: string;
  sic_description?: string;
  homepage_url?: string;
}

interface PolygonTickerDetailResponse {
  status: string;
  results?: PolygonTickerDetail;
}

interface PolygonTickerSearchItem {
  ticker: string;
  name: string;
  type: string;
  primary_exchange: string;
  active: boolean;
}

interface PolygonTickerSearchResponse {
  status: string;
  results?: PolygonTickerSearchItem[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface PolygonAdapterConfig {
  /** Request timeout in milliseconds. Default: 10 000 */
  timeoutMs?: number;
  /** Maximum retries on 429 rate-limit. Default: 3 */
  maxRetries?: number;
  /** Initial backoff delay in ms for rate-limit retries. Default: 1 000 */
  initialBackoffMs?: number;
}

const DEFAULT_CONFIG: Required<PolygonAdapterConfig> = {
  timeoutMs: 10_000,
  maxRetries: 3,
  initialBackoffMs: 1_000,
};

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

/**
 * Translate a human-readable range key into { from, to } date strings
 * (YYYY-MM-DD) suitable for the Polygon aggregates endpoint.
 */
function rangeToDates(range: string): { from: string; to: string } {
  const now = new Date();
  const to = formatDate(now);

  const map: Record<string, number> = {
    '1W': 7,
    '1M': 30,
    '3M': 90,
    '6M': 180,
    '1Y': 365,
    '2Y': 730,
    '5Y': 1825,
    YTD: 0, // handled separately
  };

  if (range.toUpperCase() === 'YTD') {
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return { from: formatDate(jan1), to };
  }

  const days = map[range.toUpperCase()];
  if (days === undefined) {
    // Fallback: treat as 1Y
    const from = new Date(now);
    from.setDate(from.getDate() - 365);
    return { from: formatDate(from), to };
  }

  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from: formatDate(from), to };
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safe conversion of a value to a finite number, returning fallback on NaN/Infinity. */
function safeNumber(value: unknown, fallback: number = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Safely convert a nanosecond or millisecond timestamp to an ISO string. */
function safeTimestamp(ns: unknown, divisor: number = 1): string {
  const raw = Number(ns);
  if (!Number.isFinite(raw) || raw <= 0) {
    return new Date().toISOString();
  }
  const ms = divisor > 1 ? Math.floor(raw / divisor) : raw;
  const d = new Date(ms);
  // Guard against "Invalid Date"
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Redact API key from a URL for safe logging. */
function redactUrl(url: string, apiKey: string): string {
  return url.replace(apiKey, '***');
}

/** Validate that a symbol string is non-empty after trimming. */
function validateSymbol(symbol: string): string {
  const trimmed = symbol.trim();
  if (!trimmed) {
    throw new Error('PolygonMassiveAdapter: Symbol must be a non-empty string.');
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PolygonMassiveAdapter implements MarketDataProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly config: Required<PolygonAdapterConfig>;

  constructor(
    apiKey: string = process.env.POLYGON_API_KEY ?? '',
    baseUrl: string = process.env.POLYGON_BASE_URL ?? 'https://api.polygon.io',
    config: PolygonAdapterConfig = {},
  ) {
    if (!apiKey) {
      throw new Error(
        'PolygonMassiveAdapter: POLYGON_API_KEY is required. ' +
          'Pass it to the constructor or set the environment variable.',
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // strip trailing slashes
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // MarketDataProvider implementation
  // -----------------------------------------------------------------------

  async getQuote(symbol: string): Promise<Quote> {
    const sym = validateSymbol(symbol);
    const url =
      `${this.baseUrl}/v2/snapshot/locale/us/markets/stocks/tickers/` +
      `${encodeURIComponent(sym.toUpperCase())}?apiKey=${this.apiKey}`;

    const data = await this.fetchWithRetry<PolygonSnapshotSingleResponse>(url);

    if (!data.ticker) {
      throw new PolygonApiError(
        404,
        `No snapshot data returned for symbol "${sym}"`,
        redactUrl(url, this.apiKey),
      );
    }

    return this.mapSnapshotToQuote(data.ticker);
  }

  async getBatchQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    // Validate and deduplicate
    const uniqueSymbols = [
      ...new Set(symbols.map((s) => validateSymbol(s).toUpperCase())),
    ];

    const tickers = uniqueSymbols.join(',');
    const url =
      `${this.baseUrl}/v2/snapshot/locale/us/markets/stocks/tickers` +
      `?tickers=${encodeURIComponent(tickers)}&apiKey=${this.apiKey}`;

    const data = await this.fetchWithRetry<PolygonSnapshotMultiResponse>(url);

    // Filter out any malformed ticker entries that lack a ticker identifier
    const validTickers = (data.tickers ?? []).filter(
      (t) => t && typeof t.ticker === 'string' && t.ticker.length > 0,
    );

    return validTickers.map((t) => this.mapSnapshotToQuote(t));
  }

  async getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
    const sym = validateSymbol(symbol);
    const { from, to } = rangeToDates(range);
    const url =
      `${this.baseUrl}/v2/aggs/ticker/` +
      `${encodeURIComponent(sym.toUpperCase())}/range/1/day/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=5000&apiKey=${this.apiKey}`;

    const data = await this.fetchWithRetry<PolygonAggsResponse>(url);

    // Filter out bars with missing essential OHLC fields
    const validBars = (data.results ?? []).filter(
      (bar) =>
        bar &&
        Number.isFinite(bar.t) &&
        Number.isFinite(bar.o) &&
        Number.isFinite(bar.h) &&
        Number.isFinite(bar.l) &&
        Number.isFinite(bar.c),
    );

    return validBars.map((bar) => this.mapAggToOHLC(bar));
  }

  async getFundamentals(symbol: string): Promise<Fundamentals> {
    const sym = validateSymbol(symbol);
    const url =
      `${this.baseUrl}/v3/reference/tickers/` +
      `${encodeURIComponent(sym.toUpperCase())}?apiKey=${this.apiKey}`;

    const data = await this.fetchWithRetry<PolygonTickerDetailResponse>(url);

    if (!data.results) {
      // Return a minimal Fundamentals object rather than crashing
      return { symbol: sym.toUpperCase() };
    }

    return this.mapTickerDetailToFundamentals(data.results);
  }

  async searchSymbol(query: string): Promise<SymbolResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const url =
      `${this.baseUrl}/v3/reference/tickers` +
      `?search=${encodeURIComponent(trimmed)}` +
      `&market=stocks&active=true&limit=10&apiKey=${this.apiKey}`;

    const data = await this.fetchWithRetry<PolygonTickerSearchResponse>(url);

    // Filter out entries missing required fields
    const validResults = (data.results ?? []).filter(
      (item) =>
        item &&
        typeof item.ticker === 'string' &&
        item.ticker.length > 0 &&
        typeof item.name === 'string',
    );

    return validResults.map((item) => this.mapSearchItem(item));
  }

  // -----------------------------------------------------------------------
  // Private helpers — mapping Polygon shapes -> provider-agnostic models
  // -----------------------------------------------------------------------

  private mapSnapshotToQuote(t: PolygonSnapshotTicker): Quote {
    // Prefer last-trade price -> day close -> prevDay close -> 0
    const price =
      t.lastTrade?.p ?? t.day?.c ?? t.prevDay?.c ?? 0;

    // `updated` and `lastTrade.t` are nanosecond-precision; convert to ms
    const timestamp = t.lastTrade?.t
      ? safeTimestamp(t.lastTrade.t, 1_000_000)
      : safeTimestamp(t.updated, 1_000_000);

    return {
      symbol: t.ticker,
      price: safeNumber(price),
      change: safeNumber(t.todaysChange),
      changePercent: safeNumber(t.todaysChangePerc),
      timestamp,
      isRealtime: true,
    };
  }

  private mapAggToOHLC(bar: PolygonAggBar): OHLC {
    return {
      timestamp: safeTimestamp(bar.t),
      open: safeNumber(bar.o),
      high: safeNumber(bar.h),
      low: safeNumber(bar.l),
      close: safeNumber(bar.c),
      volume: safeNumber(bar.v),
    };
  }

  private mapTickerDetailToFundamentals(d: PolygonTickerDetail): Fundamentals {
    return {
      symbol: d.ticker,
      name: d.name ?? undefined,
      description: d.description ?? undefined,
      marketCap: d.market_cap != null ? safeNumber(d.market_cap) : undefined,
      primaryExchange: d.primary_exchange ?? undefined,
      type: d.type ?? undefined,
      // Polygon doesn't separate sector/industry; sic_description is closest
      industry: d.sic_description ?? undefined,
      website: d.homepage_url ?? undefined,
    };
  }

  private mapSearchItem(item: PolygonTickerSearchItem): SymbolResult {
    return {
      symbol: item.ticker,
      name: item.name ?? '',
      type: item.type ?? '',
      primaryExchange: item.primary_exchange ?? '',
      active: item.active ?? true,
    };
  }

  // -----------------------------------------------------------------------
  // HTTP helper with timeout, rate-limit retry, and error classification
  // -----------------------------------------------------------------------

  /**
   * Fetch with automatic retry on 429 rate-limit responses.
   * Uses exponential backoff with jitter.
   */
  private async fetchWithRetry<T>(url: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.fetchOnce<T>(url);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Only retry on rate-limit errors
        if (err instanceof PolygonRateLimitError && attempt < this.config.maxRetries) {
          const backoff =
            err.retryAfterMs > 0
              ? err.retryAfterMs
              : this.config.initialBackoffMs * Math.pow(2, attempt);
          // Add jitter: +/- 20%
          const jitter = backoff * (0.8 + Math.random() * 0.4);
          await this.sleep(jitter);
          continue;
        }

        throw lastError;
      }
    }

    // Should not be reached, but satisfies the compiler
    throw lastError ?? new Error('PolygonMassiveAdapter: Unexpected retry exhaustion');
  }

  /**
   * Single HTTP request with timeout and error classification.
   */
  private async fetchOnce<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    let res: Response;
    try {
      res = await globalThis.fetch(url, { signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);

      // AbortController signals abort as an AbortError or DOMException
      if (
        err instanceof DOMException ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw new PolygonTimeoutError(
          this.config.timeoutMs,
          redactUrl(url, this.apiKey),
        );
      }

      // Network error (DNS failure, connection refused, etc.)
      throw new Error(
        `PolygonMassiveAdapter: Network error — ${err instanceof Error ? err.message : String(err)} — ${redactUrl(url, this.apiKey)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      // Rate limit detection
      if (res.status === 429) {
        const retryAfterHeader = res.headers.get('Retry-After');
        const retryAfterMs = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1_000
          : this.config.initialBackoffMs;
        throw new PolygonRateLimitError(
          Number.isFinite(retryAfterMs) ? retryAfterMs : this.config.initialBackoffMs,
          redactUrl(url, this.apiKey),
        );
      }

      throw new PolygonApiError(
        res.status,
        res.statusText,
        redactUrl(url, this.apiKey),
      );
    }

    // Parse JSON safely
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new Error(
        `PolygonMassiveAdapter: Invalid JSON in response — ${redactUrl(url, this.apiKey)}`,
      );
    }

    if (body === null || typeof body !== 'object') {
      throw new Error(
        `PolygonMassiveAdapter: Unexpected response shape — ${redactUrl(url, this.apiKey)}`,
      );
    }

    return body as T;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
