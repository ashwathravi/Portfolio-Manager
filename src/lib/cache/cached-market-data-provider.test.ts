import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import { CachedMarketDataProvider } from './cached-market-data-provider';
import { InMemoryCache } from './in-memory-cache';
import type { MarketDataProvider, Quote, OHLC, Fundamentals, SymbolResult } from '@/types/market-data';

function quote(symbol: string, price = 100): Quote {
    return { symbol, price, change: 1, changePercent: 1, timestamp: '2026-04-19T00:00:00Z', isRealtime: true };
}

class FakeProvider implements MarketDataProvider {
    getQuoteCalls = 0;
    getBatchCalls: string[][] = [];
    getHistoricalCalls = 0;
    getFundamentalsCalls = 0;
    searchCalls = 0;
    priceBySymbol = new Map<string, number>();

    constructor() {
        this.priceBySymbol.set('AAPL', 100);
        this.priceBySymbol.set('MSFT', 200);
        this.priceBySymbol.set('GOOG', 300);
    }

    async getQuote(symbol: string): Promise<Quote> {
        this.getQuoteCalls++;
        return quote(symbol, this.priceBySymbol.get(symbol) ?? 0);
    }

    async getBatchQuotes(symbols: string[]): Promise<Quote[]> {
        this.getBatchCalls.push([...symbols]);
        return symbols.map((s) => quote(s, this.priceBySymbol.get(s) ?? 0));
    }

    async getHistoricalPrices(_symbol: string, _range: string): Promise<OHLC[]> {
        this.getHistoricalCalls++;
        return [{ timestamp: '2026-04-19', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }];
    }

    async getFundamentals(symbol: string): Promise<Fundamentals> {
        this.getFundamentalsCalls++;
        return { symbol, name: 'Fake' };
    }

    async searchSymbol(query: string): Promise<SymbolResult[]> {
        this.searchCalls++;
        return [{ symbol: query.toUpperCase(), name: query, type: 'CS', primaryExchange: 'X', active: true }];
    }
}

describe('CachedMarketDataProvider', () => {
    let inner: FakeProvider;
    let cache: InMemoryCache;
    let provider: CachedMarketDataProvider;

    beforeEach(() => {
        inner = new FakeProvider();
        cache = new InMemoryCache();
        provider = new CachedMarketDataProvider(inner, cache);
    });

    describe('getQuote', () => {
        it('caches single quote and hits on second call', async () => {
            const a = await provider.getQuote('AAPL');
            const b = await provider.getQuote('AAPL');
            assert.deepStrictEqual(a, b);
            assert.strictEqual(inner.getQuoteCalls, 1);
        });

        it('is case-insensitive on the cache key', async () => {
            await provider.getQuote('aapl');
            await provider.getQuote('AAPL');
            assert.strictEqual(inner.getQuoteCalls, 1);
        });
    });

    describe('getBatchQuotes', () => {
        it('returns empty array when called with no symbols (no inner call)', async () => {
            const out = await provider.getBatchQuotes([]);
            assert.deepStrictEqual(out, []);
            assert.strictEqual(inner.getBatchCalls.length, 0);
        });

        it('fetches only missing symbols when some are cached', async () => {
            await provider.getQuote('AAPL'); // seed AAPL in cache
            const out = await provider.getBatchQuotes(['AAPL', 'MSFT', 'GOOG']);

            assert.strictEqual(out.length, 3);
            // Batch call should only contain the misses
            assert.deepStrictEqual(inner.getBatchCalls, [['MSFT', 'GOOG']]);
        });

        it('skips inner call entirely when all symbols are cached', async () => {
            await provider.getQuote('AAPL');
            await provider.getQuote('MSFT');
            inner.getBatchCalls = [];

            const out = await provider.getBatchQuotes(['AAPL', 'MSFT']);
            assert.strictEqual(out.length, 2);
            assert.strictEqual(inner.getBatchCalls.length, 0);
        });
    });

    describe('getHistoricalPrices', () => {
        it('caches by (symbol, range) pair', async () => {
            await provider.getHistoricalPrices('AAPL', '1M');
            await provider.getHistoricalPrices('AAPL', '1M');
            await provider.getHistoricalPrices('AAPL', '3M'); // different range = different key
            assert.strictEqual(inner.getHistoricalCalls, 2);
        });
    });

    describe('getFundamentals', () => {
        it('caches per symbol', async () => {
            await provider.getFundamentals('AAPL');
            await provider.getFundamentals('AAPL');
            assert.strictEqual(inner.getFundamentalsCalls, 1);
        });
    });

    describe('searchSymbol', () => {
        it('normalizes query for the cache key (trim + lowercase)', async () => {
            await provider.searchSymbol('Apple');
            await provider.searchSymbol('  apple  ');
            assert.strictEqual(inner.searchCalls, 1);
        });
    });

    describe('TTL configuration', () => {
        it('accepts custom TTL overrides', async () => {
            const customProvider = new CachedMarketDataProvider(inner, cache, {
                ttl: { quote: 1, historical: 1, fundamentals: 1, search: 1 },
            });
            // Just verifying construction — runtime TTL behavior is covered by InMemoryCache tests.
            await customProvider.getQuote('AAPL');
            assert.strictEqual(inner.getQuoteCalls, 1);
        });
    });
});
