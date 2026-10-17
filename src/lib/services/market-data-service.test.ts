import { afterEach, describe, it, mock } from 'node:test';
import * as assert from 'node:assert';
import { MarketDataService, getMarketDataService, loadQuotes } from './market-data-service';
import { MarketDataNotConfiguredError } from '@/lib/providers/errors';
import { PolygonApiError } from '@/lib/providers/polygon-massive-adapter';
import type { MarketDataProvider, Quote, OHLC, Fundamentals, SymbolResult } from '@/types/market-data';

function stubProvider(): MarketDataProvider & { calls: Record<string, number> } {
    const calls = { getQuote: 0, getBatchQuotes: 0, getHistoricalPrices: 0, getFundamentals: 0, searchSymbol: 0 };
    return {
        calls,
        async getQuote(symbol: string): Promise<Quote> {
            calls.getQuote++;
            return { symbol, price: 42, change: 0, changePercent: 0, timestamp: '2026-04-19T00:00:00Z', isRealtime: true };
        },
        async getBatchQuotes(symbols: string[]): Promise<Quote[]> {
            calls.getBatchQuotes++;
            return symbols.map((s) => ({ symbol: s, price: 1, change: 0, changePercent: 0, timestamp: '2026-04-19T00:00:00Z', isRealtime: true }));
        },
        async getHistoricalPrices(): Promise<OHLC[]> {
            calls.getHistoricalPrices++;
            return [];
        },
        async getFundamentals(symbol: string): Promise<Fundamentals> {
            calls.getFundamentals++;
            return { symbol };
        },
        async searchSymbol(): Promise<SymbolResult[]> {
            calls.searchSymbol++;
            return [];
        },
    };
}

describe('MarketDataService', () => {
    it('passes getQuote through to the injected provider', async () => {
        const provider = stubProvider();
        const service = new MarketDataService(provider);
        const q = await service.getQuote('AAPL');
        assert.strictEqual(q.price, 42);
        assert.strictEqual(provider.calls.getQuote, 1);
    });

    it('passes getBatchQuotes through', async () => {
        const provider = stubProvider();
        const service = new MarketDataService(provider);
        const quotes = await service.getBatchQuotes(['A', 'B']);
        assert.strictEqual(quotes.length, 2);
        assert.strictEqual(provider.calls.getBatchQuotes, 1);
    });

    it('passes getHistoricalPrices through', async () => {
        const provider = stubProvider();
        const service = new MarketDataService(provider);
        await service.getHistoricalPrices('AAPL', '1M');
        assert.strictEqual(provider.calls.getHistoricalPrices, 1);
    });

    it('passes getFundamentals through', async () => {
        const provider = stubProvider();
        const service = new MarketDataService(provider);
        const f = await service.getFundamentals('AAPL');
        assert.strictEqual(f.symbol, 'AAPL');
        assert.strictEqual(provider.calls.getFundamentals, 1);
    });

    it('passes searchSymbol through', async () => {
        const provider = stubProvider();
        const service = new MarketDataService(provider);
        await service.searchSymbol('q');
        assert.strictEqual(provider.calls.searchSymbol, 1);
    });

    it('constructs with the default provider even without POLYGON_API_KEY', async () => {
        const saved = process.env.POLYGON_API_KEY;
        delete process.env.POLYGON_API_KEY;
        try {
            const service = new MarketDataService();
            await assert.rejects(service.getQuote('AAPL'), MarketDataNotConfiguredError);
            assert.ok(getMarketDataService() instanceof MarketDataService);
        } finally {
            if (saved !== undefined) process.env.POLYGON_API_KEY = saved;
        }
    });

    describe('getQuotes', () => {
        it('keys quotes by uppercase symbol, asking once for each distinct symbol', async () => {
            const provider = stubProvider();
            const asked: string[][] = [];
            provider.getBatchQuotes = async (symbols) => {
                asked.push(symbols);
                return symbols.filter((s) => s !== 'FXAIX').map((s) => ({
                    symbol: s.toLowerCase(), price: 10, change: 1, changePercent: 11.1, timestamp: '2026-07-02T20:00:00.000Z', isRealtime: false,
                }));
            };

            const quotes = await new MarketDataService(provider).getQuotes(['aapl', ' AAPL ', 'msft', '', 'FXAIX']);

            assert.deepStrictEqual(asked, [['AAPL', 'MSFT', 'FXAIX']]);
            assert.deepStrictEqual(Object.keys(quotes), ['AAPL', 'MSFT']);
            assert.strictEqual(quotes.AAPL.price, 10);
        });

        it('answers no symbols without asking the provider', async () => {
            const provider = stubProvider();
            assert.deepStrictEqual(await new MarketDataService(provider).getQuotes([' ', '']), {});
            assert.strictEqual(provider.calls.getBatchQuotes, 0);
        });
    });
});

describe('loadQuotes', () => {
    afterEach(() => mock.restoreAll());

    function failingService(error: unknown): MarketDataService {
        const provider = stubProvider();
        provider.getBatchQuotes = async () => {
            throw error;
        };
        return new MarketDataService(provider);
    }

    it('returns the quotes keyed by uppercase symbol', async () => {
        const quotes = await loadQuotes(['spy'], new MarketDataService(stubProvider()));
        assert.deepStrictEqual(Object.keys(quotes), ['SPY']);
    });

    it('returns {} without a word when market data is not configured', async () => {
        const warn = mock.method(console, 'warn', () => {});
        const error = mock.method(console, 'error', () => {});

        const quotes = await loadQuotes(['AAPL'], failingService(new MarketDataNotConfiguredError('POLYGON_API_KEY')));

        assert.deepStrictEqual(quotes, {});
        assert.strictEqual(warn.mock.callCount(), 0);
        assert.strictEqual(error.mock.callCount(), 0);
    });

    it('returns {} with one concise warning for any other failure', async () => {
        const warn = mock.method(console, 'warn', () => {});

        const quotes = await loadQuotes(['AAPL'], failingService(new PolygonApiError(500, 'Internal Server Error', 'https://api.test/v2/aggs?apiKey=***')));

        assert.deepStrictEqual(quotes, {});
        assert.strictEqual(warn.mock.callCount(), 1);
        const args = warn.mock.calls[0].arguments;
        assert.strictEqual(args.length, 1, 'one line, no error object (and so no stack trace)');
        assert.match(String(args[0]), /^Market data unavailable, showing stored prices: PolygonMassiveAdapter: HTTP 500/);
    });

    it('returns {} for a thrown non-Error too', async () => {
        const warn = mock.method(console, 'warn', () => {});
        assert.deepStrictEqual(await loadQuotes(['AAPL'], failingService('socket hang up')), {});
        assert.match(String(warn.mock.calls[0].arguments[0]), /socket hang up/);
    });

    it('answers an empty list without touching market data', async () => {
        const provider = stubProvider();
        assert.deepStrictEqual(await loadQuotes([], new MarketDataService(provider)), {});
        assert.strictEqual(provider.calls.getBatchQuotes, 0);
    });
});
