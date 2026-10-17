import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { HistoricalBar } from './index';
import type { Quote } from '@/types/market-data';

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
