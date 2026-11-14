import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { historyRangeSchema, timeframeSchema } from '@/lib/validators/market-data';

import { MarketDataNotConfiguredError } from './errors';
import {
  PolygonApiError,
  PolygonMassiveAdapter,
  PolygonRateLimitError,
  PolygonTimeoutError,
  PLAN_HISTORY_DAYS,
  rangeToDates,
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
        { symbol: 'AAPL', price: 101.5, change: 1.5, changePercent: 1.5, timestamp: '2026-07-02T20:00:00.000Z', kind: 'close', isRealtime: false },
        { symbol: 'MSFT', price: 200, change: -50, changePercent: -20, timestamp: '2026-07-02T20:00:00.000Z', kind: 'close', isRealtime: false },
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

    test('a symbol with no earlier close has a price but no change', async () => {
      const { fetch } = fakeFetch(byDate({
        '2026-07-02': { body: grouped(bar('NEWCO', 25)) },
        '2026-07-01': { body: grouped() },
      }));

      const quote = await adapter(fetch).getQuote('NEWCO');

      assert.deepEqual([quote.price, quote.change, quote.changePercent], [25, null, null]);
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
    test('maps grouped rows to daily bars; a ticker with unreadable prices stays in, unpriced', async () => {
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
        // Kept so the ingest can count it as rejected; never a quote.
        ['NOPRICE', { symbol: 'NOPRICE', date: '2026-06-30', open: 1, high: 1, low: 1, close: Number.NaN, volume: 1 }],
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

    test('a spent shared quota answers 429 without a request, and is not retried', async () => {
      const { fetch, calls } = fakeFetch(() => ({ body: grouped(bar('AAPL', 1)) }));
      let reserved = 0;
      const quota = { reserve: async () => (reserved++, { allowed: false as const, retryAfterMs: 30_000 }) };

      await assert.rejects(adapter(fetch, { quota, maxRetries: 3 }).getDailyBars('2026-07-02'), (err: unknown) => {
        assert.ok(err instanceof PolygonRateLimitError);
        assert.equal(err.retryAfterMs, 30_000);
        assert.ok(!err.message.includes(KEY));
        return true;
      });
      assert.deepEqual([calls.length, reserved], [0, 1]);
    });

    test('every HTTP attempt takes a token from the shared quota', async () => {
      let attempts = 0;
      const { fetch } = fakeFetch(() => (++attempts === 1 ? { status: 429, body: {} } : { body: grouped(bar('AAPL', 1)) }));
      let reserved = 0;
      const quota = { reserve: async () => (reserved++, { allowed: true as const }) };

      await adapter(fetch, { quota, maxRetries: 1, initialBackoffMs: 1 }).getDailyBars('2026-07-02');
      assert.deepEqual([attempts, reserved], [2, 2]);
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

    test('ticker reference data: name, type and industry code, or null for an unknown ticker', async () => {
      const { fetch, calls } = fakeFetch((url) => {
        if (url.includes('/v3/reference/tickers/AAPL')) {
          return {
            body: {
              status: 'OK',
              results: {
                ticker: 'AAPL', name: 'Apple Inc.', type: 'CS', primary_exchange: 'XNAS', active: true,
                currency_name: 'usd', sic_code: '3571', sic_description: 'ELECTRONIC COMPUTERS',
              },
            },
          };
        }
        if (url.includes('/v3/reference/tickers/SPY')) {
          return { body: { status: 'OK', results: { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'ETF', sic_code: '  ' } } };
        }
        return { status: 404, body: { status: 'NOT_FOUND' } };
      });
      const provider = adapter(fetch);

      assert.deepEqual(await provider.getTickerReference('aapl'), {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        type: 'CS',
        primaryExchange: 'XNAS',
        active: true,
        currency: 'usd',
        sicCode: '3571',
        sicDescription: 'ELECTRONIC COMPUTERS',
      });
      assert.equal(calls[0], `${BASE}/v3/reference/tickers/AAPL?apiKey=${KEY}`);
      const fund = await provider.getTickerReference('SPY');
      assert.deepEqual([fund?.type, fund?.sicCode, fund?.primaryExchange, fund?.active], ['ETF', null, null, true]);
      assert.equal(await provider.getTickerReference('ZZZZZ'), null);
    });

    test("an option contract's newest close in the window, dated in New York (launch item i63)", async () => {
      const { fetch, calls } = fakeFetch((url) => {
        if (url.includes('O%3AAAPL270115C00250000')) {
          return {
            body: {
              status: 'OK',
              // Newest first, as asked; midnight New York time (04:00Z in summer).
              results: [
                { t: Date.parse('2026-10-16T04:00:00Z'), o: 21, h: 22, l: 20.5, c: 21.4, v: 12 },
                { t: Date.parse('2026-10-15T04:00:00Z'), o: 20, h: 21, l: 19.5, c: 20.1, v: 3 },
              ],
            },
          };
        }
        return { body: { status: 'OK', resultsCount: 0 } };
      });
      const provider = adapter(fetch);

      assert.deepEqual(await provider.getLatestOptionClose('O:AAPL270115C00250000', '2026-09-16', '2026-10-16'), { date: '2026-10-16', close: 21.4 });
      assert.equal(
        calls[0],
        `${BASE}/v2/aggs/ticker/O%3AAAPL270115C00250000/range/1/day/2026-09-16/2026-10-16?adjusted=true&sort=desc&limit=10&apiKey=${KEY}`,
      );
      // No trade in the window.
      assert.equal(await provider.getLatestOptionClose('O:RIVN270115C00025000', '2026-09-16', '2026-10-16'), null);
    });

    test('an option close: a plan without options answers 403, and only contract tickers are asked about', async () => {
      const { fetch, calls } = fakeFetch(() => ({ status: 403, body: { status: 'NOT_AUTHORIZED' } }));
      const provider = adapter(fetch);

      await assert.rejects(provider.getLatestOptionClose('O:AAPL270115C00250000', '2026-09-16', '2026-10-16'),
        (err: unknown) => err instanceof PolygonApiError && err.status === 403);
      await assert.rejects(provider.getLatestOptionClose('AAPL', '2026-09-16', '2026-10-16'), /not an option contract ticker/);
      assert.equal(calls.length, 1);
    });

    test('daily history counts the rows it had to leave out; charts get the same bars', async () => {
      const { fetch } = fakeFetch(() => ({
        body: {
          status: 'OK',
          results: [
            { t: Date.UTC(2026, 5, 29), o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
            { t: Date.UTC(2026, 5, 30), o: 1, h: 2, l: 0.5, c: null, v: 10 },
            { o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
            { t: Date.UTC(2026, 6, 1), o: 1, h: 2, l: 0.5, c: 1.6, v: 10 },
          ],
        },
      }));
      const provider = adapter(fetch);

      const { bars, unreadable } = await provider.getDailyHistory('AAPL', '1M');
      assert.equal(unreadable, 2);
      assert.deepEqual(bars.map((bar) => bar.close), [1.5, 1.6]);
      assert.deepEqual(await provider.getHistoricalPrices('AAPL', '1M'), bars);
    });

    test('regression (x22): 1D and 5D are the last one and five sessions of daily bars, not a year', async () => {
      // Eight sessions, oldest first; the request window has room to spare.
      const days = ['2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02'];
      const { fetch, calls } = fakeFetch(() => ({
        body: { status: 'OK', results: days.map((day, i) => ({ t: Date.parse(`${day}T04:00:00Z`), o: i, h: i, l: i, c: 100 + i, v: 10 })) },
      }));
      const provider = adapter(fetch);

      const oneDay = await provider.getHistoricalPrices('AAPL', '1D');
      assert.deepEqual(oneDay.map((bar) => bar.close), [107]);
      assert.match(calls[0], /\/range\/1\/day\/2026-06-25\/2026-07-02\?/);

      const fiveDays = await provider.getDailyHistory('AAPL', '5D');
      assert.deepEqual(fiveDays.bars.map((bar) => bar.close), [103, 104, 105, 106, 107]);
      assert.equal(fiveDays.unreadable, 0);
      assert.match(calls[1], /\/range\/1\/day\/2026-06-18\/2026-07-02\?/);
    });

    test('regression (x22): MAX asks for the whole of the plan\'s history', async () => {
      const { fetch, calls } = fakeFetch(() => ({ body: { status: 'OK', results: [] } }));
      await adapter(fetch).getHistoricalPrices('AAPL', 'MAX');
      assert.match(calls[0], /\/range\/1\/day\/2024-07-02\/2026-07-02\?/);
    });

    test('splits: one call for the date range, unreadable rows dropped', async () => {
      const { fetch, calls } = fakeFetch(() => ({
        body: {
          status: 'OK',
          results: [
            { ticker: 'NVDA', execution_date: '2026-10-15', split_from: 1, split_to: 10, adjustment_type: 'forward_split', historical_adjustment_factor: 0.1, id: 'E1' },
            { ticker: ' brk.b ', execution_date: '2026-10-16', split_from: 0, split_to: 'two' },
            { ticker: '', execution_date: '2026-10-16' },
            { ticker: 'XYZ', execution_date: 'soon' },
            { execution_date: '2026-10-16' },
          ],
        },
      }));

      const splits = await adapter(fetch).getSplits('2026-10-15', '2026-10-16');

      assert.deepEqual(calls, [
        `${BASE}/stocks/v1/splits?execution_date.gte=2026-10-15&execution_date.lte=2026-10-16&limit=5000&apiKey=${KEY}`,
      ]);
      assert.deepEqual(splits, [
        { symbol: 'NVDA', executionDate: '2026-10-15', splitFrom: 1, splitTo: 10, id: 'E1' },
        // No usable ratio: still a split (its history is cleared), but no holdings adjustment.
        { symbol: 'BRK.B', executionDate: '2026-10-16' },
      ]);
    });

    test('splits: can be narrowed to some tickers', async () => {
      const { fetch, calls } = fakeFetch(() => ({ body: { status: 'OK', results: [] } }));
      await adapter(fetch).getSplits('2026-09-01', '2026-10-16', ['BRK.B', 'NVDA']);
      assert.deepEqual(calls, [
        `${BASE}/stocks/v1/splits?execution_date.gte=2026-09-01&execution_date.lte=2026-10-16&ticker.any_of=BRK.B,NVDA&limit=5000&apiKey=${KEY}`,
      ]);
    });

    test('splits: a missing results list is no splits; bad dates are refused before any call', async () => {
      const { fetch, calls } = fakeFetch(() => ({ body: { status: 'OK' } }));
      assert.deepEqual(await adapter(fetch).getSplits('2026-10-15', '2026-10-15'), []);
      await assert.rejects(adapter(fetch).getSplits('2026-10-15', '16 Oct'), /YYYY-MM-DD/);
      assert.equal(calls.length, 1);
    });

    test('splits: an HTTP error keeps its status', async () => {
      const { fetch } = fakeFetch(() => ({ status: 403, body: { status: 'NOT_AUTHORIZED' } }));
      await assert.rejects(adapter(fetch).getSplits('2026-10-15', '2026-10-16'), (err: unknown) => {
        assert.ok(err instanceof PolygonApiError);
        assert.equal(err.status, 403);
        return true;
      });
    });
  });
});

describe('rangeToDates (x22)', () => {
  // Thu 2026-07-02, 5:00 PM EDT: that day's session has closed.
  const now = AFTER_CLOSE;

  test('day ranges reach back that many calendar days from the Eastern date', () => {
    assert.deepEqual(rangeToDates('1W', now), { from: '2026-06-25', to: '2026-07-02' });
    assert.deepEqual(rangeToDates('1M', now), { from: '2026-06-02', to: '2026-07-02' });
    assert.deepEqual(rangeToDates('3M', now), { from: '2026-04-03', to: '2026-07-02' });
    assert.deepEqual(rangeToDates('6M', now), { from: '2026-01-03', to: '2026-07-02' });
    assert.deepEqual(rangeToDates('1Y', now), { from: '2025-07-02', to: '2026-07-02' });
    assert.deepEqual(rangeToDates('2Y', now), { from: '2024-07-02', to: '2026-07-02' });
    assert.deepEqual(rangeToDates('YTD', now), { from: '2026-01-01', to: '2026-07-02' });
  });

  test('MAX is the plan\'s two years of history', () => {
    assert.deepEqual(rangeToDates('MAX', now), { from: '2024-07-02', to: '2026-07-02' });
  });

  test('1D and 5D count sessions through the last completed one, with room for one not published yet', () => {
    // Five sessions before Jul 2 for 1D; nine for 5D, skipping Juneteenth (Fri Jun 19).
    assert.deepEqual(rangeToDates('1D', now), { from: '2026-06-25', to: '2026-07-02', sessions: 1 });
    assert.deepEqual(rangeToDates('5D', now), { from: '2026-06-18', to: '2026-07-02', sessions: 5 });
  });

  test('1D before the close and on a holiday ends at the session before', () => {
    // Thu 2026-07-02 11:00 AM EDT: Jul 2's session is still open.
    assert.equal(rangeToDates('1D', new Date('2026-07-02T15:00:00Z')).to, '2026-07-01');
    // Good Friday 2026-04-03, closed: Thursday's session is the last.
    assert.equal(rangeToDates('1D', new Date('2026-04-03T15:00:00Z')).to, '2026-04-02');
  });

  test('uses the Eastern date, not the host\'s or UTC\'s, late in the evening', () => {
    // 2026-07-03 01:00 UTC is still 9:00 PM on Jul 2 in New York.
    assert.equal(rangeToDates('1M', new Date('2026-07-03T01:00:00Z')).to, '2026-07-02');
    assert.equal(rangeToDates('YTD', new Date('2027-01-01T03:00:00Z')).from, '2026-01-01');
  });

  test('every range the history and legacy historical routes accept has a window', () => {
    for (const range of [...historyRangeSchema.options, ...timeframeSchema.options]) {
      const window = rangeToDates(range, now);
      assert.ok(window.from <= window.to, range);
    }
  });

  test('an unknown range is refused instead of silently becoming a year', () => {
    assert.throws(() => rangeToDates('1H', now), /Unknown history range "1H"/);
    assert.throws(() => rangeToDates('ALL', now), /Unknown history range "ALL"/);
  });

  test('regression (x22): no range asks for more history than the plan keeps', () => {
    // Basic keeps two years; 5Y asked Massive for five, which it can't serve.
    assert.throws(() => rangeToDates('5Y', now), /Unknown history range "5Y"/);
    const earliest = new Date(Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - PLAN_HISTORY_DAYS * 86_400_000)
      .toISOString().slice(0, 10);
    // The routes' ranges, and the nightly backfill's (price-ingest's HISTORY_RANGE).
    for (const range of [...historyRangeSchema.options, ...timeframeSchema.options, '2Y', '1W', 'YTD']) {
      assert.ok(rangeToDates(range, now).from >= earliest, range);
    }
  });
});
