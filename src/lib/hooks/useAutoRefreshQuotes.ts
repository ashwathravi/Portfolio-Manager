'use client';

import { useMemo } from 'react';
import { useQuotesQuery } from '@/lib/api/market-data/queries';
import type { MarketQuote } from '@/lib/api/market-data';
import { useSettingsStore } from '@/lib/stores/settingsStore';

const MIN_REFRESH_SECONDS = 15;

export interface UseAutoRefreshQuotesResult {
    quotes: Record<string, MarketQuote>;
    isFetching: boolean;
    isError: boolean;
    refreshMs: number;
    refetch: () => Promise<unknown>;
    lastUpdatedAt: number | null;
}

/**
 * Poll the `/api/market-data/quotes` endpoint at the user's configured
 * `marketDataRefreshSeconds` preference. Falls back to a 15s floor to avoid
 * abusing upstream provider rate limits. Polling is paused when the tab is
 * hidden (TanStack Query default).
 */
export function useAutoRefreshQuotes(symbols: readonly string[]): UseAutoRefreshQuotesResult {
    const refreshSeconds = useSettingsStore((s) => s.preferences.marketDataRefreshSeconds);
    const refreshMs = Math.max(refreshSeconds, MIN_REFRESH_SECONDS) * 1000;

    const normalizedSymbols = useMemo(
        () => [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort(),
        [symbols],
    );

    const query = useQuotesQuery(normalizedSymbols, {
        refetchInterval: refreshMs,
        staleTime: refreshMs,
    });

    return {
        quotes: query.data ?? {},
        isFetching: query.isFetching,
        isError: query.isError,
        refreshMs,
        refetch: query.refetch,
        lastUpdatedAt: query.dataUpdatedAt || null,
    };
}
