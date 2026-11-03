import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import {
    AlertsApiError,
    alertQueryKeys,
    alertsRequest,
    clearedFeed,
    feedMutationOptions,
    readInFeed,
    rulesMutationOptions,
    type AlertFeedData,
} from './queries';
import type { AlertTrigger } from './types';

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

function alert(id: string, acknowledged = false): AlertTrigger {
    return {
        id, ruleId: 'r-1', ruleName: 'AAPL above $200', metric: 'price', symbol: 'AAPL', comparator: 'gte', threshold: 200,
        observedValue: 210, triggeredAt: '2026-11-02T22:35:00.000Z', acknowledged, source: 'market', message: `Alert ${id}`,
    };
}

const FEED: AlertFeedData = { notifications: [alert('n-1'), alert('n-2'), alert('n-3', true)], unread: 2, stored: true };

function client() {
    return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe('alertsRequest (launch item i57)', () => {
    test('answers the response\'s data, sending the session cookie and JSON only with a body', async () => {
        const calls = stubFetch(() => Response.json({ data: { rules: [], limit: 50, stored: true } }));
        assert.deepEqual(await alertsRequest('/api/alerts/rules'), { rules: [], limit: 50, stored: true });
        assert.equal(calls[0].init.credentials, 'same-origin');
        assert.equal(calls[0].init.headers, undefined);

        await alertsRequest('/api/alerts/rules', { method: 'POST', body: '{}' });
        assert.deepEqual(calls[1].init.headers, { 'Content-Type': 'application/json' });
        assert.equal(calls[1].init.method, 'POST');
    });

    test('a 204 answers nothing', async () => {
        stubFetch(() => new Response(null, { status: 204 }));
        assert.equal(await alertsRequest('/api/alerts/notifications', { method: 'DELETE' }), undefined);
    });

    test('an error carries the server\'s message, or a general one', async () => {
        stubFetch(() => Response.json({ error: 'You can have at most 50 alert rules.', code: 'ALERT_RULE_LIMIT' }, { status: 409 }));
        await assert.rejects(alertsRequest('/api/alerts/rules', { method: 'POST', body: '{}' }),
            (error: unknown) => error instanceof AlertsApiError && error.message === 'You can have at most 50 alert rules.');
        stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
        await assert.rejects(alertsRequest('/api/alerts/rules'),
            (error: unknown) => error instanceof AlertsApiError && error.message === 'Something went wrong. Try again.');
    });
});

describe('readInFeed and clearedFeed', () => {
    test('reading some counts only the unread ones among them', () => {
        const feed = readInFeed(FEED, { ids: ['n-1', 'n-3', 'n-unknown'] });
        assert.deepEqual(feed.notifications.map((n) => n.acknowledged), [true, false, true]);
        assert.equal(feed.unread, 1);
        assert.equal(FEED.notifications[0].acknowledged, false, 'the cached feed is not changed in place');
    });

    test('reading all reads every one, those past the feed\'s limit included', () => {
        const feed = readInFeed({ ...FEED, unread: 70 }, { all: true });
        assert.ok(feed.notifications.every((n) => n.acknowledged));
        assert.equal(feed.unread, 0);
    });

    test('clearing empties the feed', () => {
        assert.deepEqual(clearedFeed(FEED), { notifications: [], unread: 0, stored: true });
    });
});

describe('feedMutationOptions', () => {
    test('shows the change at once, then reads the feed again', async () => {
        const queryClient = client();
        queryClient.setQueryData(alertQueryKeys.feed, FEED);
        let seenDuringRequest: AlertFeedData | undefined;
        const observer = new MutationObserver(queryClient, feedMutationOptions(queryClient, async () => {
            seenDuringRequest = queryClient.getQueryData(alertQueryKeys.feed);
        }, readInFeed));

        await observer.mutate({ all: true });
        assert.equal(seenDuringRequest?.unread, 0);
        assert.equal(queryClient.getQueryData<AlertFeedData>(alertQueryKeys.feed)?.unread, 0);
        assert.equal(queryClient.getQueryState(alertQueryKeys.feed)?.isInvalidated, true);
    });

    test('puts the feed back when the request fails, and reads it again', async () => {
        const queryClient = client();
        queryClient.setQueryData(alertQueryKeys.feed, FEED);
        const observer = new MutationObserver(queryClient, feedMutationOptions(queryClient, async () => {
            throw new AlertsApiError('Unable to clear your alerts.');
        }, clearedFeed));

        await assert.rejects(observer.mutate(undefined), /Unable to clear your alerts/);
        assert.deepEqual(queryClient.getQueryData(alertQueryKeys.feed), FEED);
        assert.equal(queryClient.getQueryState(alertQueryKeys.feed)?.isInvalidated, true);
    });

    test('without a feed loaded yet there is nothing to show early', async () => {
        const queryClient = client();
        const observer = new MutationObserver(queryClient, feedMutationOptions(queryClient, async () => {}, clearedFeed));
        await observer.mutate(undefined);
        assert.equal(queryClient.getQueryData(alertQueryKeys.feed), undefined);
    });
});

describe('rulesMutationOptions', () => {
    test('reads the rules again once a change settles, and the feed too when asked (a deletion)', async () => {
        for (const feedToo of [false, true]) {
            const queryClient = client();
            queryClient.setQueryData(alertQueryKeys.rules, { rules: [], limit: 50, stored: true });
            queryClient.setQueryData(alertQueryKeys.feed, FEED);
            const observer = new MutationObserver(queryClient, rulesMutationOptions(queryClient, async (id: string) => id, { feedToo }));
            assert.equal(await observer.mutate('r-1'), 'r-1');
            assert.equal(queryClient.getQueryState(alertQueryKeys.rules)?.isInvalidated, true);
            assert.equal(queryClient.getQueryState(alertQueryKeys.feed)?.isInvalidated, feedToo);
        }
    });

    test('a failed change still reads the rules again', async () => {
        const queryClient = client();
        queryClient.setQueryData(alertQueryKeys.rules, { rules: [], limit: 50, stored: true });
        const observer = new MutationObserver(queryClient, rulesMutationOptions(queryClient, async () => {
            throw new AlertsApiError('Alert rule not found');
        }));
        await assert.rejects(observer.mutate(undefined), /Alert rule not found/);
        assert.equal(queryClient.getQueryState(alertQueryKeys.rules)?.isInvalidated, true);
    });
});
