'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
    AlphaRadarFilingRecord,
    AlphaRadarHoldingRecord,
    AlphaRadarMemoChange,
    AlphaRadarReportRecord,
    AlphaRadarRefreshRunResult,
    AlphaRadarSemanticSearchResult,
    AlphaRadarTrackedFilerRecord,
} from '@/lib/alpha-radar';

export const alphaRadarQueryKeys = {
    all: ['alpha-radar'] as const,
    filers: () => [...alphaRadarQueryKeys.all, 'filers'] as const,
    follows: () => [...alphaRadarQueryKeys.all, 'follows'] as const,
    filings: (filerId: string, reportPeriod?: string) => [...alphaRadarQueryKeys.filers(), filerId, 'filings', reportPeriod ?? 'all'] as const,
    holdings: (filerId: string, filingId?: string, reportPeriod?: string) => [
        ...alphaRadarQueryKeys.filers(),
        filerId,
        'holdings',
        filingId ?? 'latest',
        reportPeriod ?? 'all',
    ] as const,
    changes: (filerId: string, reportPeriod?: string) => [...alphaRadarQueryKeys.filers(), filerId, 'changes', reportPeriod ?? 'latest'] as const,
    reports: (trackedFilerId?: string, reportPeriod?: string, trackedFilerIds?: readonly string[]) => [
        ...alphaRadarQueryKeys.all,
        'reports',
        trackedFilerId ?? 'all',
        reportPeriod ?? 'latest',
        ...(trackedFilerIds ? ['filers', [...trackedFilerIds].sort().join(',')] : []),
    ] as const,
    memorySearch: (query: string, trackedFilerId?: string, reportPeriod?: string) => [
        ...alphaRadarQueryKeys.all,
        'memory-search',
        query,
        trackedFilerId ?? 'all',
        reportPeriod ?? 'all',
    ] as const,
};

export interface AlphaRadarRefreshRequest {
    force?: boolean;
    filingLimit?: number;
}

export async function fetchAlphaRadarFilers(): Promise<AlphaRadarTrackedFilerRecord[]> {
    return fetchJsonData('/api/alpha-radar/filers');
}

/** The IDs of the filers the signed-in user follows (launch item i60). */
export async function fetchAlphaRadarFollows(): Promise<string[]> {
    const data = await fetchJsonData<{ filerIds: string[] }>('/api/alpha-radar/follows', { cache: 'no-store' });
    return data.filerIds;
}

export async function setAlphaRadarFollow(filerId: string, following: boolean): Promise<void> {
    await fetchJsonData(`/api/alpha-radar/follows/${encodeURIComponent(filerId)}`, { method: following ? 'PUT' : 'DELETE' });
}

export async function fetchAlphaRadarFilings(
    filerId: string,
    reportPeriod?: string,
): Promise<AlphaRadarFilingRecord[]> {
    const params = new URLSearchParams();
    if (reportPeriod) params.set('reportPeriod', reportPeriod);
    return fetchJsonData(`/api/alpha-radar/filers/${encodeURIComponent(filerId)}/filings${queryString(params)}`);
}

export async function fetchAlphaRadarHoldings(input: {
    filerId: string;
    filingId?: string;
    reportPeriod?: string;
}): Promise<AlphaRadarHoldingRecord[]> {
    const params = new URLSearchParams();
    if (input.filingId) params.set('filingId', input.filingId);
    if (input.reportPeriod) params.set('reportPeriod', input.reportPeriod);
    return fetchJsonData(`/api/alpha-radar/filers/${encodeURIComponent(input.filerId)}/holdings${queryString(params)}`);
}

export async function fetchAlphaRadarChanges(
    filerId: string,
    reportPeriod?: string,
): Promise<AlphaRadarMemoChange[]> {
    const params = new URLSearchParams();
    if (reportPeriod) params.set('reportPeriod', reportPeriod);
    return fetchJsonData(`/api/alpha-radar/filers/${encodeURIComponent(filerId)}/changes${queryString(params)}`);
}

export async function fetchAlphaRadarReports(input: {
    trackedFilerId?: string;
    /** Reports from any of these filers (the ones the user follows). */
    trackedFilerIds?: readonly string[];
    reportPeriod?: string;
} = {}): Promise<AlphaRadarReportRecord[]> {
    const params = new URLSearchParams();
    if (input.trackedFilerId) params.set('trackedFilerId', input.trackedFilerId);
    if (input.trackedFilerIds) params.set('trackedFilerIds', input.trackedFilerIds.join(','));
    if (input.reportPeriod) params.set('reportPeriod', input.reportPeriod);
    return fetchJsonData(`/api/alpha-radar/reports${queryString(params)}`);
}

export async function searchAlphaRadarMemory(input: {
    query: string;
    trackedFilerId?: string;
    reportPeriod?: string;
    limit?: number;
}): Promise<AlphaRadarSemanticSearchResult> {
    const params = new URLSearchParams();
    params.set('query', input.query);
    if (input.trackedFilerId) params.set('trackedFilerId', input.trackedFilerId);
    if (input.reportPeriod) params.set('reportPeriod', input.reportPeriod);
    if (input.limit) params.set('limit', String(input.limit));
    return fetchJsonData(`/api/alpha-radar/memory/search${queryString(params)}`);
}

export async function refreshAlphaRadarAll(input: AlphaRadarRefreshRequest = {}): Promise<AlphaRadarRefreshRunResult> {
    return fetchJsonData('/api/alpha-radar/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
}

export async function refreshAlphaRadarFiler(
    filerId: string,
    input: AlphaRadarRefreshRequest = {},
): Promise<AlphaRadarRefreshRunResult> {
    return fetchJsonData(`/api/alpha-radar/filers/${encodeURIComponent(filerId)}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
}

export function useAlphaRadarFilersQuery(
    options?: Omit<UseQueryOptions<AlphaRadarTrackedFilerRecord[], Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<AlphaRadarTrackedFilerRecord[], Error>({
        queryKey: alphaRadarQueryKeys.filers(),
        queryFn: fetchAlphaRadarFilers,
        staleTime: 5 * 60 * 1000,
        ...options,
    });
}

export function useAlphaRadarFollowsQuery(
    options?: Omit<UseQueryOptions<string[], Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<string[], Error>({
        queryKey: alphaRadarQueryKeys.follows(),
        queryFn: fetchAlphaRadarFollows,
        staleTime: 60_000,
        ...options,
    });
}

/**
 * Follows or unfollows a filer, showing the change at once and putting it
 * back if the save fails. Callers allow one change at a time (isPending), so
 * two requests can't land in the wrong order.
 */
export function useFollowAlphaRadarFilerMutation() {
    const queryClient = useQueryClient();
    const key = alphaRadarQueryKeys.follows();
    return useMutation({
        mutationFn: ({ filerId, following }: { filerId: string; following: boolean }) => setAlphaRadarFollow(filerId, following),
        onMutate: async ({ filerId, following }) => {
            await queryClient.cancelQueries({ queryKey: key });
            const previous = queryClient.getQueryData<string[]>(key);
            queryClient.setQueryData<string[]>(key, (ids = []) => (
                following ? [...ids.filter((id) => id !== filerId), filerId] : ids.filter((id) => id !== filerId)
            ));
            return { previous };
        },
        onError: (_error, _input, context) => {
            if (context?.previous) queryClient.setQueryData(key, context.previous);
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
    });
}

export function useAlphaRadarReportsQuery(
    input: { trackedFilerId?: string; trackedFilerIds?: readonly string[]; reportPeriod?: string } = {},
    options?: Omit<UseQueryOptions<AlphaRadarReportRecord[], Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<AlphaRadarReportRecord[], Error>({
        queryKey: alphaRadarQueryKeys.reports(input.trackedFilerId, input.reportPeriod, input.trackedFilerIds),
        queryFn: () => fetchAlphaRadarReports(input),
        ...options,
    });
}

export function useAlphaRadarFilingsQuery(
    filerId: string,
    reportPeriod?: string,
    options?: Omit<UseQueryOptions<AlphaRadarFilingRecord[], Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<AlphaRadarFilingRecord[], Error>({
        queryKey: alphaRadarQueryKeys.filings(filerId, reportPeriod),
        queryFn: () => fetchAlphaRadarFilings(filerId, reportPeriod),
        enabled: Boolean(filerId),
        ...options,
    });
}

export function useAlphaRadarHoldingsQuery(
    input: { filerId: string; filingId?: string; reportPeriod?: string },
    options?: Omit<UseQueryOptions<AlphaRadarHoldingRecord[], Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<AlphaRadarHoldingRecord[], Error>({
        queryKey: alphaRadarQueryKeys.holdings(input.filerId, input.filingId, input.reportPeriod),
        queryFn: () => fetchAlphaRadarHoldings(input),
        enabled: Boolean(input.filerId),
        ...options,
    });
}

export function useAlphaRadarChangesQuery(
    filerId: string,
    reportPeriod?: string,
    options?: Omit<UseQueryOptions<AlphaRadarMemoChange[], Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<AlphaRadarMemoChange[], Error>({
        queryKey: alphaRadarQueryKeys.changes(filerId, reportPeriod),
        queryFn: () => fetchAlphaRadarChanges(filerId, reportPeriod),
        enabled: Boolean(filerId),
        ...options,
    });
}

export function useAlphaRadarMemorySearchQuery(
    input: { query: string; trackedFilerId?: string; reportPeriod?: string; limit?: number },
    options?: Omit<UseQueryOptions<AlphaRadarSemanticSearchResult, Error>, 'queryKey' | 'queryFn'>,
) {
    return useQuery<AlphaRadarSemanticSearchResult, Error>({
        queryKey: alphaRadarQueryKeys.memorySearch(input.query, input.trackedFilerId, input.reportPeriod),
        queryFn: () => searchAlphaRadarMemory(input),
        enabled: input.query.trim().length > 0 && (options?.enabled ?? true),
        staleTime: 60_000,
        ...options,
    });
}

export function useRefreshAlphaRadarAllMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: refreshAlphaRadarAll,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: alphaRadarQueryKeys.all }),
    });
}

export function useRefreshAlphaRadarFilerMutation(filerId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: AlphaRadarRefreshRequest = {}) => refreshAlphaRadarFiler(filerId, input),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: alphaRadarQueryKeys.all }),
    });
}

async function fetchJsonData<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : `Alpha Radar request failed (${response.status})`);
    }
    return body.data as T;
}

function queryString(params: URLSearchParams): string {
    const value = params.toString();
    return value ? `?${value}` : '';
}
