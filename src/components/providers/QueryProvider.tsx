'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Creates a QueryClient with defaults tuned for market data:
 * - staleTime 60s so quotes aren't re-fetched on every component mount.
 * - gcTime 5m so tab-switch navigations read from cache.
 * - one retry on network failures, no refetch on window focus (market data
 *   providers are rate-limited and quotes in this app are not latency-critical).
 */
export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 60 * 1000,
                gcTime: 5 * 60 * 1000,
                retry: 1,
                refetchOnWindowFocus: false,
            },
        },
    });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
    const [client] = useState(() => createQueryClient());
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
