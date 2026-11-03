'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { AlertRuleInput } from '@/lib/validators/alerts';

import type { AlertRule, AlertTrigger } from './types';

/**
 * Alert rules and the notifications they raise, kept with the account
 * (launch item i57): /api/alerts/rules and /api/alerts/notifications.
 * `stored` is false on a server without a database, where nothing is kept.
 */

export const alertQueryKeys = {
    rules: ['alerts', 'rules'] as const,
    feed: ['alerts', 'notifications'] as const,
};

export interface AlertRulesData {
    rules: AlertRule[];
    limit: number;
    stored: boolean;
}

export interface AlertFeedData {
    notifications: AlertTrigger[];
    unread: number;
    stored: boolean;
}

/** The rule as the API takes it: a symbol only where the metric uses one. */
export type AlertRuleBody = Omit<AlertRuleInput, 'symbol' | 'note'> & { symbol?: string; note?: string };

export class AlertsApiError extends Error {}

/** A call to /api/alerts: the response's `data`, or an AlertsApiError with the server's message. */
export async function alertsRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...init,
        headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new AlertsApiError(typeof body?.error === 'string' ? body.error : 'Something went wrong. Try again.');
    }
    return body.data as T;
}

export function useAlertRules() {
    return useQuery({
        queryKey: alertQueryKeys.rules,
        queryFn: () => alertsRequest<AlertRulesData>('/api/alerts/rules'),
        staleTime: 30_000,
    });
}

/**
 * A change to the rules: the list is read again once it settles, and the
 * feed too when the change can remove alerts (deleting a rule deletes them).
 */
export function rulesMutationOptions<V, T>(
    queryClient: QueryClient,
    mutationFn: (variables: V) => Promise<T>,
    { feedToo = false }: { feedToo?: boolean } = {},
) {
    return {
        mutationFn,
        onSettled: () => Promise.all([
            queryClient.invalidateQueries({ queryKey: alertQueryKeys.rules }),
            feedToo ? queryClient.invalidateQueries({ queryKey: alertQueryKeys.feed }) : undefined,
        ]),
    };
}

export const createAlertRule = (rule: AlertRuleBody) =>
    alertsRequest<AlertRule>('/api/alerts/rules', { method: 'POST', body: JSON.stringify(rule) });

export const updateAlertRule = ({ id, rule }: { id: string; rule: AlertRuleBody }) =>
    alertsRequest<AlertRule>(`/api/alerts/rules/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(rule) });

export const deleteAlertRule = (id: string) =>
    alertsRequest<void>(`/api/alerts/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });

export function useCreateAlertRule() {
    return useMutation(rulesMutationOptions(useQueryClient(), createAlertRule));
}

export function useUpdateAlertRule() {
    return useMutation(rulesMutationOptions(useQueryClient(), updateAlertRule));
}

export function useDeleteAlertRule() {
    return useMutation(rulesMutationOptions(useQueryClient(), deleteAlertRule, { feedToo: true }));
}

/** The feed is written each weekday evening; reading it on focus picks that up. */
export function useAlertFeed() {
    return useQuery({
        queryKey: alertQueryKeys.feed,
        queryFn: () => alertsRequest<AlertFeedData>('/api/alerts/notifications'),
        staleTime: 60_000,
        refetchOnWindowFocus: true,
    });
}

/**
 * A change to the feed, shown at once: `apply` updates the cached feed
 * before the request, the cache goes back if the request fails, and the
 * feed is read again either way.
 */
export function feedMutationOptions<V>(
    queryClient: QueryClient,
    mutationFn: (variables: V) => Promise<unknown>,
    apply: (feed: AlertFeedData, variables: V) => AlertFeedData,
) {
    return {
        mutationFn,
        onMutate: async (variables: V) => {
            await queryClient.cancelQueries({ queryKey: alertQueryKeys.feed });
            const previous = queryClient.getQueryData<AlertFeedData>(alertQueryKeys.feed);
            if (previous) queryClient.setQueryData(alertQueryKeys.feed, apply(previous, variables));
            return { previous };
        },
        onError: (_error: unknown, _variables: V, context: { previous?: AlertFeedData } | undefined) => {
            if (context?.previous) queryClient.setQueryData(alertQueryKeys.feed, context.previous);
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: alertQueryKeys.feed }),
    };
}

export type AlertsToRead = { ids: string[] } | { all: true };

/** The feed with those notifications read. */
export function readInFeed(feed: AlertFeedData, which: AlertsToRead): AlertFeedData {
    const read = (n: AlertTrigger) => 'all' in which || which.ids.includes(n.id);
    const notifications = feed.notifications.map((n) => (read(n) ? { ...n, acknowledged: true } : n));
    const newlyRead = feed.notifications.filter((n) => !n.acknowledged && read(n)).length;
    return { ...feed, notifications, unread: 'all' in which ? 0 : Math.max(0, feed.unread - newlyRead) };
}

/** The feed once cleared. */
export function clearedFeed(feed: AlertFeedData): AlertFeedData {
    return { ...feed, notifications: [], unread: 0 };
}

export const markAlertsRead = (which: AlertsToRead) =>
    alertsRequest<void>('/api/alerts/notifications', { method: 'PATCH', body: JSON.stringify(which) });

export const clearAlerts = () => alertsRequest<void>('/api/alerts/notifications', { method: 'DELETE' });

export function useMarkAlertsRead() {
    return useMutation(feedMutationOptions(useQueryClient(), markAlertsRead, readInFeed));
}

export function useClearAlerts() {
    return useMutation(feedMutationOptions(useQueryClient(), clearAlerts, clearedFeed));
}
