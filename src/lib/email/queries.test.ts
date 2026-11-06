import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import {
    EmailApiError,
    emailQueryKeys,
    emailRequest,
    preferencesMutationOptions,
    saveEmailPreferences,
    type EmailPreferencesData,
} from './queries';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(respond: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return respond(url, init);
    }) as typeof fetch;
    return calls;
}

const PREFERENCES: EmailPreferencesData = { alerts: false, weeklyReview: true, address: 'a@example.test', sending: true, stored: true };

function client() {
    return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe('emailRequest (launch item i58)', () => {
    test('answers the response\'s data, sending the session cookie and JSON only with a body', async () => {
        const calls = stubFetch(() => Response.json({ data: PREFERENCES }));
        assert.deepEqual(await emailRequest('/api/email/preferences'), PREFERENCES);
        assert.equal(calls[0].init.credentials, 'same-origin');
        assert.equal(calls[0].init.headers, undefined);

        await saveEmailPreferences({ alerts: true });
        assert.equal(calls[1].url, '/api/email/preferences');
        assert.equal(calls[1].init.method, 'PUT');
        assert.equal(calls[1].init.body, '{"alerts":true}');
        assert.deepEqual(calls[1].init.headers, { 'Content-Type': 'application/json' });
    });

    test('an error carries the server\'s message, or a general one', async () => {
        stubFetch(() => Response.json({ error: 'Email settings are kept with your account, and this server has no database.' }, { status: 503 }));
        await assert.rejects(saveEmailPreferences({ alerts: true }),
            (error: unknown) => error instanceof EmailApiError && error.message.startsWith('Email settings are kept with your account'));
        stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
        await assert.rejects(emailRequest('/api/email/preferences'), { message: 'Something went wrong. Try again.' });
    });
});

describe('preferencesMutationOptions', () => {
    test('the switch moves at once, then the choices are read again', async () => {
        const queryClient = client();
        queryClient.setQueryData(emailQueryKeys.preferences, PREFERENCES);
        let seenDuringRequest: EmailPreferencesData | undefined;
        const observer = new MutationObserver(queryClient, preferencesMutationOptions(queryClient, async () => {
            seenDuringRequest = queryClient.getQueryData(emailQueryKeys.preferences);
        }));

        await observer.mutate({ alerts: true });
        assert.deepEqual(seenDuringRequest, { ...PREFERENCES, alerts: true });
        assert.equal(queryClient.getQueryState(emailQueryKeys.preferences)?.isInvalidated, true);
    });

    test('a failed save puts the switch back', async () => {
        const queryClient = client();
        queryClient.setQueryData(emailQueryKeys.preferences, PREFERENCES);
        const observer = new MutationObserver(queryClient, preferencesMutationOptions(queryClient, async () => {
            throw new EmailApiError('Unable to save your email settings.');
        }));

        await assert.rejects(observer.mutate({ weeklyReview: false }), /Unable to save/);
        assert.deepEqual(queryClient.getQueryData(emailQueryKeys.preferences), PREFERENCES);
        assert.equal(queryClient.getQueryState(emailQueryKeys.preferences)?.isInvalidated, true);
    });
});
