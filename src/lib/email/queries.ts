'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { EmailPreferencesInput } from '@/lib/validators/email';

/**
 * Which emails the user gets, kept with the account (launch item i58):
 * /api/email/preferences. `stored` is false on a server without a
 * database; `sending` is false on one that doesn't send email.
 */

export const emailQueryKeys = {
    preferences: ['email', 'preferences'] as const,
};

export interface EmailPreferencesData {
    alerts: boolean;
    weeklyReview: boolean;
    address: string | null;
    sending: boolean;
    stored: boolean;
}

export class EmailApiError extends Error {}

/** A call to /api/email: the response's `data`, or an EmailApiError with the server's message. */
export async function emailRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...init,
        headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new EmailApiError(typeof body?.error === 'string' ? body.error : 'Something went wrong. Try again.');
    }
    return body.data as T;
}

export function useEmailPreferences() {
    return useQuery({
        queryKey: emailQueryKeys.preferences,
        queryFn: () => emailRequest<EmailPreferencesData>('/api/email/preferences'),
        staleTime: 30_000,
    });
}

export const saveEmailPreferences = (input: EmailPreferencesInput) =>
    emailRequest<Pick<EmailPreferencesData, 'alerts' | 'weeklyReview'>>('/api/email/preferences', {
        method: 'PUT',
        body: JSON.stringify(input),
    });

/** A switch shows its new position at once, goes back if the save fails, and the choices are read again either way. */
export function preferencesMutationOptions(
    queryClient: QueryClient,
    mutationFn: (input: EmailPreferencesInput) => Promise<unknown> = saveEmailPreferences,
) {
    return {
        mutationFn,
        onMutate: async (input: EmailPreferencesInput) => {
            await queryClient.cancelQueries({ queryKey: emailQueryKeys.preferences });
            const previous = queryClient.getQueryData<EmailPreferencesData>(emailQueryKeys.preferences);
            if (previous) queryClient.setQueryData<EmailPreferencesData>(emailQueryKeys.preferences, { ...previous, ...input });
            return { previous };
        },
        onError: (_error: unknown, _input: EmailPreferencesInput, context: { previous?: EmailPreferencesData } | undefined) => {
            if (context?.previous) queryClient.setQueryData(emailQueryKeys.preferences, context.previous);
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: emailQueryKeys.preferences }),
    };
}

export function useSaveEmailPreferences() {
    const queryClient = useQueryClient();
    return useMutation(preferencesMutationOptions(queryClient));
}
