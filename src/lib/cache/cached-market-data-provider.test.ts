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

    async getHistoricalPrices(): Promise<OHLC[]> {
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

        it('shares one upstream fetch across concurrent cache misses', async () => {
            inner.getQuote = async (symbol: string): Promise<Quote> => {
                inner.getQuoteCalls++;
                await new Promise((resolve) => setTimeout(resolve, 5));
                return quote(symbol, inner.priceBySymbol.get(symbol) ?? 0);
            };

            const [a, b, c] = await Promise.all([
                provider.getQuote('AAPL'),
                provider.getQuote('aapl'),
                provider.getQuote('AAPL'),
            ]);

            assert.strictEqual(inner.getQuoteCalls, 1);
            assert.deepStrictEqual(a, b);
            assert.deepStrictEqual(b, c);
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

        it('deduplicates overlapping concurrent batch misses by symbol', async () => {
            inner.getBatchQuotes = async (symbols: string[]): Promise<Quote[]> => {
                inner.getBatchCalls.push([...symbols]);
                await new Promise((resolve) => setTimeout(resolve, 5));
                return symbols.map((s) => quote(s, inner.priceBySymbol.get(s) ?? 0));
            };

            const [first, second] = await Promise.all([
                provider.getBatchQuotes(['AAPL', 'MSFT']),
                provider.getBatchQuotes(['MSFT', 'AAPL']),
            ]);

            assert.strictEqual(inner.getBatchCalls.length, 1);
            assert.deepStrictEqual(first.map((q) => q.symbol), ['AAPL', 'MSFT']);
            assert.deepStrictEqual(second.map((q) => q.symbol), ['MSFT', 'AAPL']);
        });

        // Regression: one symbol the provider has no price for (a mutual
        // fund, BTC-USD on a stocks feed) rejected the whole batch, so every
        // other holding lost its quote too.
        it('omits symbols the provider returned no quote for and keeps the rest', async () => {
            inner.getBatchQuotes = async (symbols: string[]): Promise<Quote[]> => {
                inner.getBatchCalls.push([...symbols]);
                return symbols.filter((s) => inner.priceBySymbol.has(s)).map((s) => quote(s, inner.priceBySymbol.get(s)));
            };

            const out = await provider.getBatchQuotes(['AAPL', 'FXAIX', 'MSFT']);
            assert.deepStrictEqual(out.map((q) => q.symbol), ['AAPL', 'MSFT']);
        });

        it('a concurrent getQuote for a symbol the batch lacks asks the provider itself', async () => {
            inner.getBatchQuotes = async (symbols: string[]): Promise<Quote[]> => {
                inner.getBatchCalls.push([...symbols]);
                await new Promise((resolve) => setTimeout(resolve, 5));
                return symbols.filter((s) => inner.priceBySymbol.has(s)).map((s) => quote(s));
            };
            inner.getQuote = async (symbol: string): Promise<Quote> => {
                inner.getQuoteCalls++;
                throw new Error(`no price for ${symbol}`);
            };

            const [batch, single] = await Promise.allSettled([
                provider.getBatchQuotes(['AAPL', 'FXAIX']),
                provider.getQuote('FXAIX'),
            ]);

            assert.strictEqual(batch.status, 'fulfilled');
            if (batch.status === 'fulfilled') assert.deepStrictEqual(batch.value.map((q) => q.symbol), ['AAPL']);
            assert.strictEqual(single.status, 'rejected');
            if (single.status === 'rejected') assert.match(String(single.reason), /no price for FXAIX/);
            assert.strictEqual(inner.getQuoteCalls, 1);
        });

        // Regression: the opposite order. A single-quote request already in
        // flight rejected, and the batch that shared it rejected too,
        // dropping AAPL.
        it('a batch that shares a failing getQuote keeps its other quotes', async () => {
            inner.getQuote = async (symbol: string): Promise<Quote> => {
                inner.getQuoteCalls++;
                await new Promise((resolve) => setTimeout(resolve, 5));
                throw new Error(`no price for ${symbol}`);
            };
            inner.getBatchQuotes = async (symbols: string[]): Promise<Quote[]> => {
                inner.getBatchCalls.push([...symbols]);
                return symbols.filter((s) => inner.priceBySymbol.has(s)).map((s) => quote(s));
            };

            const single = provider.getQuote('FXAIX');
            const batch = provider.getBatchQuotes(['AAPL', 'FXAIX']);
            const [batchResult, singleResult] = await Promise.allSettled([batch, single]);

            assert.strictEqual(singleResult.status, 'rejected');
            assert.strictEqual(batchResult.status, 'fulfilled');
            if (batchResult.status === 'fulfilled') assert.deepStrictEqual(batchResult.value.map((q) => q.symbol), ['AAPL']);
            // AAPL in the batch's own call; FXAIX asked again by the batch after the shared request failed.
            assert.deepStrictEqual(inner.getBatchCalls, [['AAPL'], ['FXAIX']]);
        });

        it('a symbol whose shared request failed is quoted when the batch can price it', async () => {
            let failSingle = true;
            inner.getQuote = async (symbol: string): Promise<Quote> => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                if (failSingle) throw new Error('transient');
                return quote(symbol);
            };

            const single = provider.getQuote('MSFT');
            const batch = provider.getBatchQuotes(['AAPL', 'MSFT']);
            const [batchResult] = await Promise.allSettled([batch, single]);

            assert.strictEqual(batchResult.status, 'fulfilled');
            if (batchResult.status === 'fulfilled') assert.deepStrictEqual(batchResult.value.map((q) => [q.symbol, q.price]), [['AAPL', 100], ['MSFT', 200]]);
            // The retried quote is cached for the next caller.
            failSingle = false;
            inner.getBatchCalls = [];
            assert.strictEqual((await provider.getBatchQuotes(['MSFT']))[0].price, 200);
            assert.deepStrictEqual(inner.getBatchCalls, []);
        });

        it('rejects with the provider error when the whole batch fails', async () => {
            class ProviderDown extends Error {}
            inner.getBatchQuotes = async (): Promise<Quote[]> => {
                throw new ProviderDown('down');
            };

            await assert.rejects(provider.getBatchQuotes(['AAPL', 'MSFT']), ProviderDown);
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
