/**
 * PolygonMassiveAdapter — MarketDataProvider implementation backed by the
 * Massive (formerly Polygon.io) REST API on the free Basic plan (decision
 * D4): end-of-day data, two years of history, 5 calls a minute.
 *
 * Basic has no snapshot (live quote) endpoints, so a quote here is the latest
 * session's closing price from the market-wide grouped daily bars, with the
 * change measured against the session before (two calls price every symbol;
 * bars are cached per date in this process). The app itself reads quotes
 * from the Postgres price store (StoredQuoteProvider) so request paths never
 * spend the shared rate limit; the nightly ingest (i32) fills that store
 * through getDailyBars.
 *
 * Environment variables:
 *   POLYGON_API_KEY  — API key appended to every request. Without one the
 *                      adapter still constructs, and every request rejects
 *                      with MarketDataNotConfiguredError before any fetch.
 *   POLYGON_BASE_URL — base URL, defaults to https://api.polygon.io
 */

import {
  easternDateTime,
  getMarketDay,
  lastCompletedSession,
  previousTradingDay,
} from '@/lib/markets/market-hours';
import type {
  Fundamentals,
  MarketDataProvider,
  OHLC,
  Quote,
  SymbolResult,
} from '@/types/market-data';

import { MarketDataNotConfiguredError } from './errors';

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

/** A grouped daily bar: an aggregate bar plus the ticker it belongs to. */
interface PolygonGroupedBar extends PolygonAggBar {
  T: string;
}

/** GET /stocks/v1/splits (replaces the deprecated /v3/reference/splits). */
interface PolygonSplitsResponse {
  status: string;
  results?: Array<{ ticker?: string; execution_date?: string }>;
  next_url?: string;
}

interface PolygonGroupedResponse {
  status: string;
  resultsCount?: number;
  results?: PolygonGroupedBar[];
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
// Public shapes
// ---------------------------------------------------------------------------

/** A stock split: from its execution date on, adjusted prices use the new scale. */
export interface SplitEvent {
  symbol: string;
  /** Eastern trading date, YYYY-MM-DD. */
  executionDate: string;
}

/**
 * One symbol's bar for one session. Matches the price store's
 * `PriceBarInput` apart from `source`, so the nightly ingest (i32) can
 * store these as they are.
 */
export interface DailyBar {
  symbol: string;
  /** Eastern trading date, YYYY-MM-DD. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PolygonAdapterConfig {
  /** Request timeout in milliseconds. Default: 10 000 */
  timeoutMs?: number;
  /** Maximum retries on 429 rate-limit. Default: 3 */
  maxRetries?: number;
  /** Initial backoff delay in ms for rate-limit retries. Default: 1 000 */
  initialBackoffMs?: number;
  /** Clock that picks the latest session and ages cached bars. Default: the system clock */
  now?: () => Date;
  /** fetch implementation. Default: `globalThis.fetch`, looked up per request */
  fetch?: typeof globalThis.fetch;
}

type RetryConfig = Required<Pick<PolygonAdapterConfig, 'timeoutMs' | 'maxRetries' | 'initialBackoffMs'>>;

const DEFAULT_CONFIG: RetryConfig = {
  timeoutMs: 10_000,
  maxRetries: 3,
  initialBackoffMs: 1_000,
};

/**
 * A published day's bars change only when a split restates the adjusted
 * prices, so even a full day is refetched hourly. An empty day usually
 * means it isn't published yet; it is asked for again after 10 minutes.
 */
const DAILY_BARS_TTL_MS = 60 * 60_000;
const EMPTY_DAILY_BARS_TTL_MS = 10 * 60_000;
/** Quotes read two or three days. A day's file holds every US stock (a few MB). */
const MAX_CACHED_DAYS = 4;

const NYSE_CLOSE_MINUTES = 16 * 60;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

/**
 * Translate a human-readable range key into { from, to } date strings
 * (YYYY-MM-DD) suitable for the Polygon aggregates endpoint.
 */
function rangeToDates(range: string, now: Date): { from: string; to: string } {
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

/** Safely convert a millisecond timestamp to an ISO string. */
function safeTimestamp(ms: unknown): string {
  const raw = Number(ms);
  if (!Number.isFinite(raw) || raw <= 0) {
    return new Date().toISOString();
  }
  const d = new Date(raw);
  // Guard against "Invalid Date"
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Redact the API key from a URL (or any message quoting one) for safe logging. */
function redactUrl(url: string, apiKey: string): string {
  return apiKey ? url.split(apiKey).join('***') : url;
}

/** Validate that a symbol string is non-empty after trimming. */
function validateSymbol(symbol: string): string {
  const trimmed = symbol.trim();
  if (!trimmed) {
    throw new Error('PolygonMassiveAdapter: Symbol must be a non-empty string.');
  }
  return trimmed;
}

/** The latest session with published bars, the session before it, and when it closed. */
interface ClosingSessions {
  date: string;
  closedAt: string;
  bars: Map<string, DailyBar>;
  previous: Map<string, DailyBar>;
}

/**
 * A symbol's closing quote, or undefined when the session has no positive
 * close for it: an unpriced symbol is left out, never valued at zero.
 */
function closingQuote(symbol: string, sessions: ClosingSessions): Quote | undefined {
  const bar = sessions.bars.get(symbol);
  if (!bar || !(bar.close > 0)) return undefined;

  // Without an earlier close (the symbol's first session) there is no
  // change to measure: it is unknown, not zero.
  const previousClose = sessions.previous.get(symbol)?.close ?? 0;
  const change = previousClose > 0 ? bar.close - previousClose : null;
  return {
    symbol,
    price: bar.close,
    change,
    changePercent: change !== null ? (change / previousClose) * 100 : null,
    timestamp: sessions.closedAt,
    isRealtime: false,
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PolygonMassiveAdapter implements MarketDataProvider {
  /** False without an API key; every request then rejects with MarketDataNotConfiguredError. */
  readonly isConfigured: boolean;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly config: RetryConfig;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof globalThis.fetch | undefined;
  /** Grouped daily bars by date. Concurrent callers share the pending request. */
  private readonly dailyBarsCache = new Map<string, { bars: Promise<Map<string, DailyBar>>; expiresAt: number }>();

  constructor(
    apiKey: string = process.env.POLYGON_API_KEY ?? '',
    baseUrl: string = process.env.POLYGON_BASE_URL || 'https://api.polygon.io',
    config: PolygonAdapterConfig = {},
  ) {
    this.apiKey = apiKey.trim();
    this.isConfigured = this.apiKey.length > 0;
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // strip trailing slashes
    const { now, fetch, ...retry } = config;
    this.config = { ...DEFAULT_CONFIG, ...retry };
    this.now = now ?? (() => new Date());
    this.fetchImpl = fetch;
  }

  // -----------------------------------------------------------------------
  // MarketDataProvider implementation
  // -----------------------------------------------------------------------

  async getQuote(symbol: string): Promise<Quote> {
    this.assertConfigured();
    const sym = validateSymbol(symbol).toUpperCase();
    const sessions = await this.latestSessions();
    const quote = closingQuote(sym, sessions);

    if (!quote) {
      throw new PolygonApiError(
        404,
        `No closing price for symbol "${sym}"`,
        redactUrl(this.groupedDailyUrl(sessions.date), this.apiKey),
      );
    }

    return quote;
  }

  async getBatchQuotes(symbols: string[]): Promise<Quote[]> {
    this.assertConfigured();
    if (symbols.length === 0) return [];

    // Validate and deduplicate
    const uniqueSymbols = [
      ...new Set(symbols.map((s) => validateSymbol(s).toUpperCase())),
    ];

    const sessions = await this.latestSessions();
    return uniqueSymbols.flatMap((s) => closingQuote(s, sessions) ?? []);
  }

  async getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
    this.assertConfigured();
    const sym = validateSymbol(symbol);
    const { from, to } = rangeToDates(range, this.now());
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
    this.assertConfigured();
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
    this.assertConfigured();
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
  // Grouped daily bars — the free plan's source of closing prices
  // -----------------------------------------------------------------------

  /**
   * Every US stock's split-adjusted bar for one session, keyed by symbol:
   * one call covers the whole market. Results are cached per date and
   * concurrent requests share one call. A day with no bars (not published
   * yet, or not a trading day) comes back as an empty map. Quotes read it
   * here; the nightly ingest (i32) reuses it.
   */
  async getDailyBars(date: string): Promise<Map<string, DailyBar>> {
    this.assertConfigured();
    if (!ISO_DATE.test(date)) {
      throw new Error(`PolygonMassiveAdapter: Expected a date as YYYY-MM-DD, got "${date}".`);
    }

    const cached = this.dailyBarsCache.get(date);
    if (cached && cached.expiresAt > this.now().getTime()) return cached.bars;

    // Re-inserted so the map stays in fetch order and the oldest day goes first.
    const entry = { bars: this.fetchDailyBars(date), expiresAt: Number.POSITIVE_INFINITY };
    this.dailyBarsCache.delete(date);
    this.dailyBarsCache.set(date, entry);
    for (const key of this.dailyBarsCache.keys()) {
      if (this.dailyBarsCache.size <= MAX_CACHED_DAYS) break;
      this.dailyBarsCache.delete(key);
    }

    try {
      const bars = await entry.bars;
      entry.expiresAt =
        this.now().getTime() + (bars.size > 0 ? DAILY_BARS_TTL_MS : EMPTY_DAILY_BARS_TTL_MS);
      return bars;
    } catch (err) {
      // Failures are not cached: the next caller asks again.
      if (this.dailyBarsCache.get(date) === entry) this.dailyBarsCache.delete(date);
      throw err;
    }
  }

  /**
   * The last completed session and the one before it. When the last
   * session's bars aren't published yet, the session before stands in, so
   * quotes show the latest closing prices that exist.
   */
  private async latestSessions(): Promise<ClosingSessions> {
    let date = lastCompletedSession(this.now());
    let previousDate = previousTradingDay(date);
    let [bars, previous] = await Promise.all([
      this.getDailyBars(date),
      this.getDailyBars(previousDate),
    ]);

    if (bars.size === 0) {
      date = previousDate;
      bars = previous;
      previousDate = previousTradingDay(date);
      previous = await this.getDailyBars(previousDate);
    }

    const closeMinutes = getMarketDay(date).closeMinutes ?? NYSE_CLOSE_MINUTES;
    return { date, closedAt: easternDateTime(date, closeMinutes).toISOString(), bars, previous };
  }

  private async fetchDailyBars(date: string): Promise<Map<string, DailyBar>> {
    let data: PolygonGroupedResponse;
    try {
      data = await this.fetchWithRetry<PolygonGroupedResponse>(this.groupedDailyUrl(date));
    } catch (err) {
      // Basic withholds the latest session until Massive publishes it at the
      // end of the day, answering 403 meanwhile: the same as not out yet. An
      // older day refused is a real plan or key problem and is thrown.
      if (err instanceof PolygonApiError && err.status === 403 && date >= lastCompletedSession(this.now())) {
        return new Map();
      }
      throw err;
    }

    const bars = new Map<string, DailyBar>();
    for (const bar of data.results ?? []) {
      // Skip malformed rows rather than failing the whole market's file
      if (
        !bar ||
        typeof bar.T !== 'string' ||
        !bar.T.trim() ||
        ![bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)
      ) {
        continue;
      }
      const symbol = bar.T.trim().toUpperCase();
      bars.set(symbol, {
        symbol,
        date,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: safeNumber(bar.v),
      });
    }
    return bars;
  }

  /**
   * Stock splits executed between two dates, inclusive (one call). Stored
   * split-adjusted history changes scale on the execution date, so the
   * nightly ingest refetches those symbols' history.
   */
  async getSplits(from: string, to: string): Promise<SplitEvent[]> {
    this.assertConfigured();
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      throw new Error(`PolygonMassiveAdapter: Expected dates as YYYY-MM-DD, got "${from}" and "${to}".`);
    }
    // Every adjustment type (forward and reverse splits, stock dividends)
    // rescales adjusted bars. 5000 is the page maximum: far more than a few
    // days of US splits, so one page is the whole answer.
    const url =
      `${this.baseUrl}/stocks/v1/splits` +
      `?execution_date.gte=${from}&execution_date.lte=${to}&limit=5000&apiKey=${this.apiKey}`;
    const data = await this.fetchWithRetry<PolygonSplitsResponse>(url);
    if (data.next_url) {
      console.warn(`PolygonMassiveAdapter: more than one page of splits between ${from} and ${to}; using the first.`);
    }
    return (data.results ?? []).flatMap((split) =>
      typeof split?.ticker === 'string' && split.ticker.trim() && typeof split.execution_date === 'string' && ISO_DATE.test(split.execution_date)
        ? [{ symbol: split.ticker.trim().toUpperCase(), executionDate: split.execution_date }]
        : [],
    );
  }

  private groupedDailyUrl(date: string): string {
    return (
      `${this.baseUrl}/v2/aggs/grouped/locale/us/market/stocks/${date}` +
      `?adjusted=true&apiKey=${this.apiKey}`
    );
  }

  private assertConfigured(): void {
    if (!this.isConfigured) throw new MarketDataNotConfiguredError('POLYGON_API_KEY');
  }

  // -----------------------------------------------------------------------
  // Private helpers — mapping Polygon shapes -> provider-agnostic models
  // -----------------------------------------------------------------------

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

    // No Next.js data cache: a grouped daily file is several MB, and the
    // adapter keeps its own per-date cache.
    const init: RequestInit = { signal: controller.signal, cache: 'no-store' };

    let res: Response;
    try {
      res = await (this.fetchImpl ? this.fetchImpl(url, init) : globalThis.fetch(url, init));
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

      // Network error (DNS failure, connection refused, etc.). The cause's
      // message can quote the URL, so it is redacted too.
      throw new Error(
        `PolygonMassiveAdapter: Network error — ${redactUrl(err instanceof Error ? err.message : String(err), this.apiKey)} — ${redactUrl(url, this.apiKey)}`,
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
