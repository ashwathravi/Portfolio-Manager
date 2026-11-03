import { useMemo } from 'react';
import { keepPreviousData, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { HistoricalBar } from './index';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { matchesStillTyped } from '@/lib/markets/ticker-search';
import type { Quote, TickerMatch } from '@/types/market-data';

export type Timeframe = '1D' | '1H' | '1M';

export function quotesQueryKey(symbols: readonly string[]) {
    // Sort and dedupe so callers that pass symbols in different order share the same cache entry.
    return ['market-data', 'quotes', [...new Set(symbols)].sort()] as const;
}

export function historicalQueryKey(symbol: string, timeframe: Timeframe) {
    return ['market-data', 'historical', symbol.toUpperCase(), timeframe] as const;
}

export async function fetchQuotes(symbols: readonly string[]): Promise<Record<string, Quote>> {
    const symbolsParam = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(',');
    const res = await fetch(`/api/market-data/quotes?symbols=${encodeURIComponent(symbolsParam)}`);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to fetch quotes (${res.status})`);
    }
    const body = await res.json();
    if (!Array.isArray(body?.data)) throw new Error('Invalid quotes response.');
    // A malformed or zero-priced entry leaves its symbol blank ("—") rather
    // than blanking the whole batch; a wrong price is never shown either way.
    const quotes: Record<string, Quote> = {};
    for (const quote of body.data) {
        if (!isQuote(quote)) continue;
        const symbol = quote.symbol.trim().toUpperCase();
        quotes[symbol] = { ...quote, symbol };
    }
    return quotes;
}

function isQuote(value: unknown): value is Quote {
    const quote = value as Partial<Quote> | null;
    return Boolean(quote)
        && typeof quote?.symbol === 'string' && quote.symbol.trim().length > 0
        // A provider fills a missing price with 0; showing it would value the holding at $0.
        && Number.isFinite(quote.price) && (quote.price ?? 0) > 0
        // No earlier close: both changes are null (unknown), never a made-up zero.
        && ((quote.change === null && quote.changePercent === null)
            || (Number.isFinite(quote.change) && Number.isFinite(quote.changePercent)))
        && typeof quote.timestamp === 'string'
        // Every price says whether it is a close or a delayed quote (launch item i33).
        && (quote.kind === 'close' || quote.kind === 'delayed')
        && typeof quote.isRealtime === 'boolean';
}

export async function fetchHistorical(
    symbol: string,
    timeframe: Timeframe,
): Promise<HistoricalBar[]> {
    const res = await fetch(
        `/api/market-data/historical?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`,
    );
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to fetch historical data (${res.status})`);
    }
    // The route answers `{ data: bars }`; older callers sent a bare array.
    const json = await res.json();
    const bars = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    return bars as HistoricalBar[];
}

export function useQuotesQuery(
    symbols: readonly string[],
    options?: Omit<UseQueryOptions<Record<string, Quote>, Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<Record<string, Quote>, Error>({
        queryKey: quotesQueryKey(symbols),
        queryFn: () => fetchQuotes(symbols),
        enabled: symbols.length > 0,
        ...options,
    });
}

export function useHistoricalQuery(
    symbol: string,
    timeframe: Timeframe,
    options?: Omit<UseQueryOptions<HistoricalBar[], Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<HistoricalBar[], Error>({
        queryKey: historicalQueryKey(symbol, timeframe),
        queryFn: () => fetchHistorical(symbol, timeframe),
        enabled: Boolean(symbol),
        ...options,
    });
}

const NO_MATCHES: readonly TickerMatch[] = [];

/** The longest search the route accepts. */
export const MAX_TICKER_SEARCH_LENGTH = 80;
/** How long typing must pause before a search goes out. */
export const TICKER_SEARCH_DEBOUNCE_MS = 200;

/** The search text as the cache keys it: trimmed, single-spaced, lowercase. */
export function normalizeTickerSearch(query: string): string {
    return query.trim().replace(/\s+/g, ' ').slice(0, MAX_TICKER_SEARCH_LENGTH).toLowerCase();
}

export function tickerSearchQueryKey(query: string) {
    return ['market-data', 'search', normalizeTickerSearch(query)] as const;
}

/** Ticker search (launch item i35); malformed entries are left out. */
export async function fetchTickerMatches(query: string, signal?: AbortSignal): Promise<TickerMatch[]> {
    const res = await fetch(`/api/market-data/search?query=${encodeURIComponent(normalizeTickerSearch(query))}`, { signal });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to search symbols (${res.status})`);
    }
    const body = await res.json();
    if (!Array.isArray(body?.data)) throw new Error('Invalid search response.');
    return body.data.filter(isTickerMatch);
}

function isTickerMatch(value: unknown): value is TickerMatch {
    const match = value as Partial<TickerMatch> | null;
    return Boolean(match)
        && typeof match?.symbol === 'string' && match.symbol.trim().length > 0
        && typeof match.name === 'string'
        && (match.exchange === null || typeof match.exchange === 'string')
        && typeof match.held === 'boolean';
}

/**
 * Matches for what's typed, once typing pauses. While the next search is
 * on its way, the last matches that still fit what's typed stay up, so the
 * list doesn't flicker and never offers a match for something no longer
 * typed; a search that fails shows none (a ticker can always be typed in
 * full).
 */
export function useTickerSearch(query: string, { enabled = true }: { enabled?: boolean } = {}) {
    const typed = normalizeTickerSearch(query);
    const debounced = useDebouncedValue(typed, TICKER_SEARCH_DEBOUNCE_MS);
    const active = enabled && debounced.length > 0 && typed.length > 0;
    const result = useQuery<TickerMatch[], Error>({
        queryKey: tickerSearchQueryKey(debounced),
        queryFn: ({ signal }) => fetchTickerMatches(debounced, signal),
        enabled: active,
        staleTime: 5 * 60_000,
        retry: false,
        placeholderData: keepPreviousData,
    });
    const found = (active && !result.isError ? result.data : undefined) ?? NO_MATCHES;
    /** The matches are for what's typed now, not an earlier search. */
    const current = debounced === typed && !result.isPlaceholderData && !result.isFetching;
    const matches = useMemo(() => (current ? found : matchesStillTyped(found, typed)), [current, found, typed]);
    return { matches, current };
}
