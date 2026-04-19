import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { MarketDataService } from './market-data-service';
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

});
