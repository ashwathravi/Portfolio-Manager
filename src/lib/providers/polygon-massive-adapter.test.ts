import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MarketDataNotConfiguredError } from './errors';
import {
  PolygonApiError,
  PolygonMassiveAdapter,
  PolygonRateLimitError,
  PolygonTimeoutError,
  type PolygonAdapterConfig,
} from './polygon-massive-adapter';

/**
 * The adapter against a fake Massive API. Every test injects `fetch` and the
 * clock, so no request leaves the process and the "latest session" is fixed.
 *
 * Clock positions used below (ET = America/New_York):
 *   2026-07-02T21:00Z = Thu 5:00 PM EDT, after the close → session 07-02, previous 07-01
 *   2026-07-02T15:00Z = Thu 11:00 AM EDT, before the close → session 07-01, previous 06-30
 *   2026-11-27T19:00Z = Fri 2:00 PM EST, after the 1:00 PM early close;
 *                       Thanksgiving (11-26) was closed → previous 11-25
 */

const BASE = 'https://api.test';
const KEY = 'secret-test-key';
const AFTER_CLOSE = new Date('2026-07-02T21:00:00Z');

interface FakeReply {
  status?: number;
  body?: unknown;
}

type Handler = (url: string, init?: RequestInit) => FakeReply | Promise<FakeReply>;

function fakeFetch(handler: Handler) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const { status = 200, body = {} } = await handler(url, init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function groupedUrl(date: string): string {
  return `${BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${KEY}`;
}

function bar(T: string, c: number) {
  return { T, o: c, h: c, l: c, c, v: 1_000, t: 0 };
}

function grouped(...results: ReturnType<typeof bar>[]) {
  return { status: 'OK', resultsCount: results.length, results };
}

/** Answers grouped-daily requests from a date → reply table; anything else is a 404. */
function byDate(days: Record<string, FakeReply>): Handler {
  return (url) => {
    const date = /\/stocks\/(\d{4}-\d{2}-\d{2})\?/.exec(url)?.[1];
    return (date && days[date]) || { status: 404, body: {} };
  };
}

function adapter(fetch: typeof globalThis.fetch, config: PolygonAdapterConfig = {}) {
  return new PolygonMassiveAdapter(KEY, BASE, {
    now: () => AFTER_CLOSE,
    fetch,
    maxRetries: 0,
    initialBackoffMs: 1,
    ...config,
  });
}

describe('PolygonMassiveAdapter', () => {
  describe('without an API key', () => {
    const savedKey = process.env.POLYGON_API_KEY;
    afterEach(() => {
      if (savedKey === undefined) delete process.env.POLYGON_API_KEY;
      else process.env.POLYGON_API_KEY = savedKey;
    });

    test('constructs from an environment without POLYGON_API_KEY', () => {
      delete process.env.POLYGON_API_KEY;
      const provider = new PolygonMassiveAdapter();
      assert.equal(provider.isConfigured, false);
    });

    test('a blank key counts as missing', () => {
      assert.equal(new PolygonMassiveAdapter('   ', BASE).isConfigured, false);
      assert.equal(new PolygonMassiveAdapter(KEY, BASE).isConfigured, true);
    });

    test('every request rejects with MarketDataNotConfiguredError before any fetch', async () => {
      const { fetch, calls } = fakeFetch(() => ({ body: grouped(bar('AAPL', 1)) }));
      const provider = new PolygonMassiveAdapter('', BASE, { fetch, now: () => AFTER_CLOSE });

      await assert.rejects(provider.getQuote('AAPL'), MarketDataNotConfiguredError);
      await assert.rejects(provider.getBatchQuotes(['AAPL']), MarketDataNotConfiguredError);
      await assert.rejects(provider.getBatchQuotes([]), MarketDataNotConfiguredError);
      await assert.rejects(provider.getDailyBars('2026-07-02'), MarketDataNotConfiguredError);
      await assert.rejects(provider.getHistoricalPrices('AAPL', '1M'), MarketDataNotConfiguredError);
      await assert.rejects(provider.getFundamentals('AAPL'), MarketDataNotConfiguredError);
      await assert.rejects(provider.searchSymbol('apple'), MarketDataNotConfiguredError);
      assert.equal(calls.length, 0);
    });

    test('the error names the setting to fix', async () => {
      const provider = new PolygonMassiveAdapter('', BASE);
      await assert.rejects(provider.getBatchQuotes(['AAPL']), /POLYGON_API_KEY/);
    });
  });

  describe('closing-price quotes', () => {
    test('price a batch from the last two sessions\' grouped bars', async () => {
      const { fetch, calls } = fakeFetch(byDate({
        '2026-07-02': { body: grouped(bar('AAPL', 101.5), bar('MSFT', 200)) },
        '2026-07-01': { body: grouped(bar('AAPL', 100), bar('MSFT', 250)) },
      }));

      const quotes = await adapter(fetch).getBatchQuotes(['aapl', ' MSFT ', 'AAPL']);

      assert.deepEqual([...calls].sort(), [groupedUrl('2026-07-01'), groupedUrl('2026-07-02')]);
      assert.deepEqual(quotes, [
        { symbol: 'AAPL', price: 101.5, change: 1.5, changePercent: 1.5, timestamp: '2026-07-02T20:00:00.000Z', isRealtime: false },
        { symbol: 'MSFT', price: 200, change: -50, changePercent: -20, timestamp: '2026-07-02T20:00:00.000Z', isRealtime: false },
      ]);
    });

    test('before today\'s close, the latest session is the day before', async () => {
      const { fetch, calls } = fakeFetch(byDate({
        '2026-07-01': { body: grouped(bar('AAPL', 100)) },
        '2026-06-30': { body: grouped(bar('AAPL', 100)) },
      }));

      const [quote] = await adapter(fetch, { now: () => new Date('2026-07-02T15:00:00Z') }).getBatchQuotes(['AAPL']);

      assert.deepEqual([...calls].sort(), [groupedUrl('2026-06-30'), groupedUrl('2026-07-01')]);
      assert.equal(quote.timestamp, '2026-07-01T20:00:00.000Z');
    });

    test('the timestamp is the session\'s close: 1:00 PM ET on an early-close day', async () => {
      const { fetch, calls } = fakeFetch(byDate({
        '2026-11-27': { body: grouped(bar('SPY', 600)) },
        '2026-11-25': { body: grouped(bar('SPY', 594)) },
      }));

      const quote = await adapter(fetch, { now: () => new Date('2026-11-27T19:00:00Z') }).getQuote('SPY');

      assert.deepEqual([...calls].sort(), [groupedUrl('2026-11-25'), groupedUrl('2026-11-27')]);
      assert.equal(quote.timestamp, '2026-11-27T18:00:00.000Z');
      assert.equal(quote.change, 6);
    });

    test('leave out symbols missing from the file or without a positive close', async () => {
      const { fetch } = fakeFetch(byDate({
        '2026-07-02': { body: grouped(bar('AAPL', 10), bar('ZERO', 0), bar('NEG', -1)) },
        '2026-07-01': { body: grouped(bar('AAPL', 10), bar('ZERO', 5), bar('NEG', 5)) },
      }));
      const provider = adapter(fetch);

      const quotes = await provider.getBatchQuotes(['AAPL', 'ZERO', 'NEG', 'FXAIX']);
      assert.deepEqual(quotes.map((q) => q.symbol), ['AAPL']);

      await assert.rejects(provider.getQuote('FXAIX'), (err: unknown) => {
        assert.ok(err instanceof PolygonApiError);
        assert.equal(err.status, 404);
        assert.match(err.message, /FXAIX/);
        assert.ok(!err.message.includes(KEY), 'the API key must not appear in the message');
        return true;
      });
      await assert.rejects(provider.getQuote('ZERO'), PolygonApiError);
    });

    test('a symbol with no earlier close reads as unchanged', async () => {
      const { fetch } = fakeFetch(byDate({
        '2026-07-02': { body: grouped(bar('NEWCO', 25)) },
        '2026-07-01': { body: grouped() },
      }));

      const quote = await adapter(fetch).getQuote('NEWCO');

      assert.deepEqual([quote.price, quote.change, quote.changePercent], [25, 0, 0]);
    });

    test('cache each day\'s bars: repeat and concurrent calls share two requests', async () => {
      const { fetch, calls } = fakeFetch(async (url) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return byDate({
          '2026-07-02': { body: grouped(bar('AAPL', 101)) },
          '2026-07-01': { body: grouped(bar('AAPL', 100)) },
        })(url);
      });
      const provider = adapter(fetch);

      await Promise.all([
        provider.getBatchQuotes(['AAPL']),
        provider.getBatchQuotes(['AAPL', 'MSFT']),
        provider.getQuote('AAPL'),
      ]);
      await provider.getBatchQuotes(['AAPL']);
      await provider.getDailyBars('2026-07-02');

      assert.equal(calls.length, 2);
    });

    test('while the session\'s file is empty, the session before stands in', async () => {
      const { fetch, calls } = fakeFetch(byDate({
        '2026-07-02': { body: grouped() },
        '2026-07-01': { body: grouped(bar('AAPL', 101)) },
        '2026-06-30': { body: grouped(bar('AAPL', 100)) },
      }));

      const [quote] = await adapter(fetch).getBatchQuotes(['AAPL']);

      assert.deepEqual([...calls].sort(), [groupedUrl('2026-06-30'), groupedUrl('2026-07-01'), groupedUrl('2026-07-02')]);
      assert.deepEqual([quote.price, quote.change, quote.timestamp], [101, 1, '2026-07-01T20:00:00.000Z']);
    });

    test('a 403 on the latest session means not published yet; on an older day it is an error', async () => {
      const withheld = fakeFetch(byDate({
        '2026-07-02': { status: 403, body: { status: 'NOT_AUTHORIZED' } },
        '2026-07-01': { body: grouped(bar('AAPL', 101)) },
        '2026-06-30': { body: grouped(bar('AAPL', 100)) },
      }));
      const [quote] = await adapter(withheld.fetch).getBatchQuotes(['AAPL']);
      assert.equal(quote.timestamp, '2026-07-01T20:00:00.000Z');

      const refused = fakeFetch(byDate({
        '2026-07-02': { body: grouped(bar('AAPL', 101)) },
        '2026-07-01': { status: 403, body: { status: 'NOT_AUTHORIZED' } },
      }));
      await assert.rejects(adapter(refused.fetch).getBatchQuotes(['AAPL']), (err: unknown) => {
        assert.ok(err instanceof PolygonApiError);
        assert.equal(err.status, 403);
        return true;
      });
    });

    test('an empty day is asked for again after ten minutes, a full one after an hour', async () => {
      let now = AFTER_CLOSE.getTime();
      const days: Record<string, FakeReply> = {
        '2026-07-02': { body: grouped() },
        '2026-07-01': { body: grouped(bar('AAPL', 101)) },
        '2026-06-30': { body: grouped(bar('AAPL', 100)) },
      };
      const { fetch, calls } = fakeFetch((url) => byDate(days)(url));
      const provider = adapter(fetch, { now: () => new Date(now) });

      await provider.getBatchQuotes(['AAPL']);
      assert.equal(calls.length, 3);

      // Published a few minutes later, but the empty answer is still cached.
      days['2026-07-02'] = { body: grouped(bar('AAPL', 103)) };
      now += 5 * 60_000;
      assert.equal((await provider.getQuote('AAPL')).price, 101);
      assert.equal(calls.length, 3);

      now += 6 * 60_000;
      const quote = await provider.getQuote('AAPL');
      assert.deepEqual([quote.price, quote.change, quote.timestamp], [103, 2, '2026-07-02T20:00:00.000Z']);
      assert.deepEqual(calls.slice(3), [groupedUrl('2026-07-02')]);

      now += 61 * 60_000;
      await provider.getQuote('AAPL');
      assert.deepEqual(calls.slice(4).sort(), [groupedUrl('2026-07-01'), groupedUrl('2026-07-02')]);
    });

    test('a failed request is not cached', async () => {
      let fail = true;
      const { fetch, calls } = fakeFetch((url) => (fail
        ? { status: 500, body: {} }
        : byDate({
          '2026-07-02': { body: grouped(bar('AAPL', 101)) },
          '2026-07-01': { body: grouped(bar('AAPL', 100)) },
        })(url)));
      const provider = adapter(fetch);

      await assert.rejects(provider.getBatchQuotes(['AAPL']), PolygonApiError);
      fail = false;
      const [quote] = await provider.getBatchQuotes(['AAPL']);

      assert.equal(quote.price, 101);
      assert.equal(calls.length, 4);
    });
  });

  describe('getDailyBars', () => {
    test('maps grouped rows to daily bars and skips malformed ones', async () => {
      const { fetch, calls } = fakeFetch(() => ({
        body: {
          status: 'OK',
          results: [
            { T: 'AAPL', o: 1, h: 2, l: 0.5, c: 1.5, v: 100, t: 1_782_000_000_000 },
            { T: '', o: 1, h: 1, l: 1, c: 1, v: 1, t: 0 },
            { T: 'NOPRICE', o: 1, h: 1, l: 1, c: null, v: 1, t: 0 },
            null,
          ],
        },
      }));

      const bars = await adapter(fetch).getDailyBars('2026-06-30');

      assert.deepEqual(calls, [groupedUrl('2026-06-30')]);
      assert.deepEqual([...bars.entries()], [
        ['AAPL', { symbol: 'AAPL', date: '2026-06-30', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
      ]);
    });

    test('refuses a malformed date without a request', async () => {
      const { fetch, calls } = fakeFetch(() => ({ body: grouped() }));
      await assert.rejects(adapter(fetch).getDailyBars('07/02/2026'), /YYYY-MM-DD/);
      assert.equal(calls.length, 0);
    });

    test('keeps only a few recent days', async () => {
      const { fetch, calls } = fakeFetch(() => ({ body: grouped(bar('AAPL', 1)) }));
      const provider = adapter(fetch);
      const days = ['2026-06-24', '2026-06-25', '2026-06-26', '2026-06-29', '2026-06-30'];

      for (const day of days) await provider.getDailyBars(day);
      await provider.getDailyBars('2026-06-30'); // newest: still cached
      await provider.getDailyBars('2026-06-24'); // oldest: evicted, fetched again

      assert.equal(calls.length, days.length + 1);
      assert.equal(calls.at(-1), groupedUrl('2026-06-24'));
    });
  });

  describe('rate limits and failures', () => {
    test('a 429 is retried with backoff, then surfaces as PolygonRateLimitError', async () => {
      const { fetch, calls } = fakeFetch(() => ({ status: 429, body: { status: 'ERROR' } }));

      await assert.rejects(
        adapter(fetch, { maxRetries: 2, initialBackoffMs: 1 }).getDailyBars('2026-07-02'),
        PolygonRateLimitError,
      );
      assert.equal(calls.length, 3);
    });

    test('a retry that succeeds answers normally', async () => {
      let attempts = 0;
      const { fetch } = fakeFetch(() => (++attempts === 1
        ? { status: 429, body: {} }
        : { body: grouped(bar('AAPL', 1)) }));

      const bars = await adapter(fetch, { maxRetries: 1, initialBackoffMs: 1 }).getDailyBars('2026-07-02');
      assert.equal(bars.get('AAPL')?.close, 1);
      assert.equal(attempts, 2);
    });

    test('the API key never appears in an error message', async () => {
      const keyless = (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(!err.message.includes(KEY), `leaked the key: ${err.message}`);
        assert.match(err.message, /\*\*\*/);
        return true;
      };

      const http = fakeFetch(() => ({ status: 500, body: {} }));
      await assert.rejects(adapter(http.fetch).getDailyBars('2026-07-02'), keyless);

      const limited = fakeFetch(() => ({ status: 429, body: {} }));
      await assert.rejects(adapter(limited.fetch).getDailyBars('2026-07-02'), keyless);

      const network = fakeFetch((url) => {
        throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND for ${url}`);
      });
      await assert.rejects(adapter(network.fetch).getDailyBars('2026-07-02'), keyless);

      const hanging = fakeFetch((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      await assert.rejects(adapter(hanging.fetch, { timeoutMs: 5 }).getDailyBars('2026-07-02'), (err: unknown) => {
        assert.ok(err instanceof PolygonTimeoutError);
        return keyless(err);
      });
    });
  });

  describe('reference and history endpoints', () => {
    test('history, fundamentals and search call the free-plan endpoints', async () => {
      const { fetch, calls } = fakeFetch((url) => {
        if (url.includes('/v2/aggs/ticker/')) {
          return { body: { status: 'OK', results: [{ t: Date.UTC(2026, 5, 30), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] } };
        }
        if (url.includes('/v3/reference/tickers/AAPL')) {
          return { body: { status: 'OK', results: { ticker: 'AAPL', name: 'Apple Inc.', market_cap: 3e12 } } };
        }
        return { body: { status: 'OK', results: [{ ticker: 'AAPL', name: 'Apple Inc.', type: 'CS', primary_exchange: 'XNAS', active: true }] } };
      });
      const provider = adapter(fetch);

      const history = await provider.getHistoricalPrices('aapl', '1M');
      const fundamentals = await provider.getFundamentals('AAPL');
      const results = await provider.searchSymbol(' apple ');

      assert.match(calls[0], /^https:\/\/api\.test\/v2\/aggs\/ticker\/AAPL\/range\/1\/day\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}\?adjusted=true&sort=asc&limit=5000&apiKey=/);
      assert.equal(calls[1], `${BASE}/v3/reference/tickers/AAPL?apiKey=${KEY}`);
      assert.equal(calls[2], `${BASE}/v3/reference/tickers?search=apple&market=stocks&active=true&limit=10&apiKey=${KEY}`);
      assert.deepEqual(history, [{ timestamp: '2026-06-30T00:00:00.000Z', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
      assert.equal(fundamentals.name, 'Apple Inc.');
      assert.deepEqual(results.map((r) => r.symbol), ['AAPL']);
    });
  });
});
