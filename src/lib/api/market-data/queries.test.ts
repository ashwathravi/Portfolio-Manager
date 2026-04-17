import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
    fetchQuotes,
    fetchHistorical,
    quotesQueryKey,
    historicalQueryKey,
} from './queries.ts';

type FetchCall = { url: string; init?: RequestInit };

const originalFetch = globalThis.fetch;
let calls: FetchCall[] = [];

function mockFetch(response: { ok: boolean; status?: number; json: unknown }) {
    calls = [];
    // @ts-expect-error minimal mock
    globalThis.fetch = async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return {
            ok: response.ok,
            status: response.status ?? (response.ok ? 200 : 500),
            json: async () => response.json,
        };
    };
}

describe('quotesQueryKey', () => {
    test('sorts symbols so cache key is stable across input order', () => {
        assert.deepStrictEqual(
            quotesQueryKey(['MSFT', 'AAPL']),
            quotesQueryKey(['AAPL', 'MSFT']),
        );
    });

    test('dedupes repeated symbols', () => {
        assert.deepStrictEqual(
            quotesQueryKey(['AAPL', 'AAPL', 'MSFT']),
            quotesQueryKey(['AAPL', 'MSFT']),
        );
    });
});

describe('historicalQueryKey', () => {
    test('normalizes symbol to uppercase', () => {
        assert.deepStrictEqual(
            historicalQueryKey('aapl', '1D'),
            historicalQueryKey('AAPL', '1D'),
        );
    });

    test('treats different timeframes as different keys', () => {
        assert.notDeepStrictEqual(
            historicalQueryKey('AAPL', '1D'),
            historicalQueryKey('AAPL', '1H'),
        );
    });
});

describe('fetchQuotes', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test('uppercases and joins symbols into the query string', async () => {
        mockFetch({ ok: true, json: {} });
        await fetchQuotes(['aapl', ' msft ']);
        assert.strictEqual(
            calls[0].url,
            '/api/market-data/quotes?symbols=AAPL%2CMSFT',
        );
    });

    test('throws with the server error message on non-2xx responses', async () => {
        mockFetch({ ok: false, status: 400, json: { error: 'bad symbols' } });
        await assert.rejects(fetchQuotes(['AAPL']), /bad symbols/);
    });

    test('throws a fallback message when the server omits an error body', async () => {
        mockFetch({ ok: false, status: 500, json: {} });
        await assert.rejects(fetchQuotes(['AAPL']), /Failed to fetch quotes/);
    });

    test('returns the parsed quote map on success', async () => {
        mockFetch({
            ok: true,
            json: {
                AAPL: {
                    symbol: 'AAPL',
                    price: 100,
                    change: 1,
                    changePercent: 1,
                    volume: 1,
                    timestamp: 0,
                },
            },
        });
        const result = await fetchQuotes(['AAPL']);
        assert.strictEqual(result.AAPL.price, 100);
    });
});

describe('fetchHistorical', () => {
    beforeEach(() => {
        // ensure previous mocks don't leak
        globalThis.fetch = originalFetch;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test('builds URL with symbol and timeframe', async () => {
        mockFetch({ ok: true, json: [] });
        await fetchHistorical('AAPL', '1D');
        assert.strictEqual(
            calls[0].url,
            '/api/market-data/historical?symbol=AAPL&timeframe=1D',
        );
    });

    test('returns empty array when the server returns a non-array body', async () => {
        mockFetch({ ok: true, json: { error: 'no data' } });
        const result = await fetchHistorical('AAPL', '1D');
        assert.deepStrictEqual(result, []);
    });

    test('throws with server error message on failure', async () => {
        mockFetch({ ok: false, status: 429, json: { error: 'rate limited' } });
        await assert.rejects(fetchHistorical('AAPL', '1D'), /rate limited/);
    });
});
