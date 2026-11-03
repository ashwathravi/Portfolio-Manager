'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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
        queryFn: () => request<AlertRulesData>('/api/alerts/rules'),
        staleTime: 30_000,
    });
}

function useRulesMutation<V>(mutationFn: (variables: V) => Promise<unknown>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSettled: () => queryClient.invalidateQueries({ queryKey: alertQueryKeys.rules }),
    });
}

export function useCreateAlertRule() {
    return useRulesMutation((rule: AlertRuleBody) =>
        request<AlertRule>('/api/alerts/rules', { method: 'POST', body: JSON.stringify(rule) }));
}

export function useUpdateAlertRule() {
    return useRulesMutation(({ id, rule }: { id: string; rule: AlertRuleBody }) =>
        request<AlertRule>(`/api/alerts/rules/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(rule) }));
}

export function useDeleteAlertRule() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => request<void>(`/api/alerts/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        onSettled: () => Promise.all([
            queryClient.invalidateQueries({ queryKey: alertQueryKeys.rules }),
            // A deleted rule's notifications go with it.
            queryClient.invalidateQueries({ queryKey: alertQueryKeys.feed }),
        ]),
    });
}

/** The feed is written each weekday evening; reading it on focus picks that up. */
export function useAlertFeed() {
    return useQuery({
        queryKey: alertQueryKeys.feed,
        queryFn: () => request<AlertFeedData>('/api/alerts/notifications'),
        staleTime: 60_000,
        refetchOnWindowFocus: true,
    });
}

function useFeedMutation<V>(mutationFn: (variables: V) => Promise<unknown>, apply: (feed: AlertFeedData, variables: V) => AlertFeedData) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onMutate: async (variables: V) => {
            await queryClient.cancelQueries({ queryKey: alertQueryKeys.feed });
            const previous = queryClient.getQueryData<AlertFeedData>(alertQueryKeys.feed);
            if (previous) queryClient.setQueryData(alertQueryKeys.feed, apply(previous, variables));
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) queryClient.setQueryData(alertQueryKeys.feed, context.previous);
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: alertQueryKeys.feed }),
    });
}

export function useMarkAlertsRead() {
    return useFeedMutation(
        (which: { ids: string[] } | { all: true }) =>
            request<void>('/api/alerts/notifications', { method: 'PATCH', body: JSON.stringify(which) }),
        (feed, which) => {
            const read = (n: AlertTrigger) => 'all' in which || which.ids.includes(n.id);
            const notifications = feed.notifications.map((n) => (read(n) ? { ...n, acknowledged: true } : n));
            const newlyRead = feed.notifications.filter((n) => !n.acknowledged && read(n)).length;
            return { ...feed, notifications, unread: 'all' in which ? 0 : Math.max(0, feed.unread - newlyRead) };
        },
    );
}

export function useClearAlerts() {
    return useFeedMutation(
        () => request<void>('/api/alerts/notifications', { method: 'DELETE' }),
        (feed) => ({ ...feed, notifications: [], unread: 0 }),
    );
}
