import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import type { PriceBarInput } from '@/lib/markets/price-store';
import { StoredQuoteProvider, type QuoteStore } from '@/lib/markets/stored-quote-provider';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';
import { MarketDataService, setMarketDataServiceForTests } from '@/lib/services/market-data-service';
import type { MarketDataProvider, OHLC } from '@/types/market-data';
import { historyRangeSchema, timeframeSchema } from '@/lib/validators/market-data';

import { GET as getHistorical } from './historical/route';
import { GET as getHistory } from './history/route';

// Which bars each range covers is in src/lib/providers/polygon-massive-adapter.test.ts;
// which of them the price store answers with, in src/lib/markets/stored-quote-provider.test.ts.
describe('GET /api/market-data/history and /historical (x22)', () => {
    before(() => {
        // No database and no provider key: as before x09, an accepted range
        // reaches the provider, which refuses before any request.
        delete process.env.DATABASE_URL;
        delete process.env.POLYGON_API_KEY;
        setMarketDataServiceForTests(null);
    });

    test('every range /history accepts reaches the provider', async () => {
        for (const range of historyRangeSchema.options) {
            const response = await getHistory(new NextRequest(`https://atlas.test/api/market-data/history?symbol=AAPL&range=${range}`));
            assert.equal(response.status, 503, range);
            assert.equal((await response.json()).code, 'MARKET_DATA_NOT_CONFIGURED', range);
        }
    });

    test('every timeframe /historical accepts reaches the provider', async () => {
        for (const timeframe of timeframeSchema.options) {
            const response = await getHistorical(new NextRequest(`https://atlas.test/api/market-data/historical?symbol=AAPL&timeframe=${timeframe}`));
            assert.equal(response.status, 503, timeframe);
            assert.equal((await response.json()).code, 'MARKET_DATA_NOT_CONFIGURED', timeframe);
        }
    });

    test('regression: an hour of intraday bars is refused, not answered with a year of daily ones', async () => {
        const response = await getHistorical(new NextRequest('https://atlas.test/api/market-data/historical?symbol=AAPL&timeframe=1H'));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'Invalid timeframe. Valid values: 1D, 1M', code: 'INVALID_TIMEFRAME' });
    });

    test('/history refuses a range it has no window for', async () => {
        const response = await getHistory(new NextRequest('https://atlas.test/api/market-data/history?symbol=AAPL&range=10Y'));
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, 'INVALID_RANGE');
    });

    test('regression: five years, more than the free plan keeps, is refused with the ranges there are', async () => {
        const response = await getHistory(new NextRequest('https://atlas.test/api/market-data/history?symbol=AAPL&range=5Y'));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'Invalid range. Valid values: 1D, 5D, 1M, 3M, 6M, 1Y, MAX', code: 'INVALID_RANGE' });
    });
});

// x09: each sparkline and thesis chart asks one of these routes for its
// symbol. With a database they answer from the stored daily bars; Massive
// is asked only for a symbol with none in the window.
describe('GET /api/market-data/history and /historical from the price store (x09)', () => {
    // Friday 13 November 2026, 5:00 PM EST: that day's session has closed.
    const NOW = Date.parse('2026-11-13T22:00:00Z');
    const stored: Record<string, PriceBarInput[]> = {
        AAPL: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map((date, i) => ({
            symbol: 'AAPL', date, open: 250 + i, high: 251 + i, low: 249 + i, close: 250.5 + i, volume: 1_000, source: 'massive',
        })),
    };
    let massiveCalls: Array<[string, string]>;
    let massive: (symbol: string) => Promise<OHLC[]>;

    before(() => {
        const store: QuoteStore = {
            configured: () => true,
            recentCloses: async () => new Map(),
            track: async () => ({ refused: [] }),
            bars: async (symbol, from, to) => (stored[symbol] ?? []).filter((bar) => bar.date >= from && bar.date <= to),
        };
        const reference: MarketDataProvider = {
            getQuote: async () => { throw new Error('not used'); },
            getBatchQuotes: async () => { throw new Error('not used'); },
            getHistoricalPrices: async (symbol, range) => {
                massiveCalls.push([symbol, range]);
                return massive(symbol);
            },
            getFundamentals: async (symbol) => ({ symbol }),
            searchSymbol: async () => [],
        };
        setMarketDataServiceForTests(new MarketDataService(new StoredQuoteProvider(reference, store, () => NOW)));
    });

    beforeEach(() => {
        massiveCalls = [];
        massive = async () => { throw new Error('Massive must not be called'); };
    });

    after(() => setMarketDataServiceForTests(null));

    test('regression: a sparkline\'s 30 days come from the stored bars, without a Massive call', async () => {
        const response = await getHistorical(new NextRequest('https://atlas.test/api/market-data/historical?symbol=aapl&timeframe=1M'));
        assert.equal(response.status, 200);
        const { data } = await response.json();
        // The envelope and bar shape the clients read.
        assert.equal(data.length, 5);
        assert.deepEqual(data[0], { timestamp: '2026-11-09T05:00:00.000Z', open: 250, high: 251, low: 249, close: 250.5, volume: 1_000 });
        assert.deepEqual(massiveCalls, []);
    });

    test('/history answers its ranges from the store too: 5D the newest five sessions, 1D the last', async () => {
        const closes = async (range: string) => {
            const response = await getHistory(new NextRequest(`https://atlas.test/api/market-data/history?symbol=AAPL&range=${range}`));
            assert.equal(response.status, 200, range);
            return ((await response.json()).data as OHLC[]).map((bar) => bar.close);
        };
        assert.deepEqual(await closes('5D'), [250.5, 251.5, 252.5, 253.5, 254.5]);
        assert.deepEqual(await closes('1D'), [254.5]);
        assert.deepEqual(await closes('MAX'), [250.5, 251.5, 252.5, 253.5, 254.5]);
        assert.deepEqual(massiveCalls, []);
    });

    test('a symbol with no stored bars falls back to Massive, which answers as it did', async () => {
        massive = async () => [{ timestamp: '2026-11-13T05:00:00.000Z', open: 9, high: 10, low: 8, close: 9.5, volume: 5 }];
        const response = await getHistory(new NextRequest('https://atlas.test/api/market-data/history?symbol=THSS&range=1M'));
        assert.equal(response.status, 200);
        assert.equal((await response.json()).data[0].close, 9.5);
        assert.deepEqual(massiveCalls, [['THSS', '1M']]);
    });

    test('the fallback stays rate-limited: a spent budget is a 429 with Retry-After', async () => {
        massive = async () => { throw new PolygonRateLimitError(30_000, 'https://api.polygon.io/v2/aggs'); };
        const response = await getHistorical(new NextRequest('https://atlas.test/api/market-data/historical?symbol=THSS&timeframe=1M'));
        assert.equal(response.status, 429);
        assert.equal(response.headers.get('Retry-After'), '30');
    });
});
