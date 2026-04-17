import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { MarketQuote, HistoricalBar } from './index';

export type Timeframe = '1D' | '1H' | '1M';

export function quotesQueryKey(symbols: readonly string[]) {
    // Sort and dedupe so callers that pass symbols in different order share the same cache entry.
    return ['market-data', 'quotes', [...new Set(symbols)].sort()] as const;
}

export function historicalQueryKey(symbol: string, timeframe: Timeframe) {
    return ['market-data', 'historical', symbol.toUpperCase(), timeframe] as const;
}

export async function fetchQuotes(symbols: readonly string[]): Promise<Record<string, MarketQuote>> {
    const symbolsParam = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(',');
    const res = await fetch(`/api/market-data/quotes?symbols=${encodeURIComponent(symbolsParam)}`);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed to fetch quotes (${res.status})`);
    }
    return (await res.json()) as Record<string, MarketQuote>;
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
    const json = await res.json();
    return Array.isArray(json) ? (json as HistoricalBar[]) : [];
}

export function useQuotesQuery(
    symbols: readonly string[],
    options?: Omit<UseQueryOptions<Record<string, MarketQuote>, Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<Record<string, MarketQuote>, Error>({
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
