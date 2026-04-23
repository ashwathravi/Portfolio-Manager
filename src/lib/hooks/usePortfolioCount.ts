'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Client hook that fetches the number of portfolios the user has. Used by
 * the sidebar user footer (AR-66) to display "Pro · N accounts".
 *
 * Cached for 5 minutes — creating a new portfolio is a rare action and
 * we'd rather avoid spamming the DB on every sidebar mount. The invalidation
 * path (when we eventually add portfolio creation from the UI) can call
 * `queryClient.invalidateQueries({ queryKey: ['portfolios', 'count'] })`.
 */
export interface PortfolioCountResult {
    count: number | null;
    isLoading: boolean;
    isError: boolean;
}

export function usePortfolioCount(): PortfolioCountResult {
    const query = useQuery({
        queryKey: ['portfolios', 'count'],
        queryFn: async (): Promise<number> => {
            const res = await fetch('/api/portfolios/count');
            if (!res.ok) {
                throw new Error(`portfolios/count HTTP ${res.status}`);
            }
            const body = (await res.json()) as { count?: number };
            return typeof body.count === 'number' ? body.count : 0;
        },
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
    return {
        count: query.data ?? null,
        isLoading: query.isLoading,
        isError: query.isError,
    };
}
