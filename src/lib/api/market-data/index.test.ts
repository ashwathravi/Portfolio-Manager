import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { MarketDataEngine, MarketDataProvider, MarketQuote, HistoricalBar } from './index';

// Helper to create a mock provider
const createMockProvider = (name: string, price: number, shouldFail = false): MarketDataProvider => ({
    name,
    getQuotes: async (symbols: string[]): Promise<Record<string, MarketQuote>> => {
        if (shouldFail) throw new Error(`${name} failed`);
        const quotes: Record<string, MarketQuote> = {};
        symbols.forEach(s => {
            quotes[s] = {
                symbol: s,
                price: price,
                change: 1,
                changePercent: 1,
                volume: 1000,
                timestamp: Date.now()
            };
        });
        return quotes;
    },
    getHistoricalData: async (symbol: string, timeframe: string): Promise<HistoricalBar[]> => {
        if (shouldFail) throw new Error(`${name} failed`);
        return [{
            time: '2024-01-01',
            open: price,
            high: price + 10,
            low: price - 10,
            close: price + 5,
            volume: 1000
        }];
    }
});

describe('MarketDataEngine', () => {
    describe('getQuotes', () => {
        it('should use primary provider if available and successful', async () => {
            const primary = createMockProvider('primary', 100);
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(primary, secondary);

            const quotes = await engine.getQuotes(['AAPL']);
            assert.ok(quotes['AAPL']);
            assert.strictEqual(quotes['AAPL'].price, 100);
        });

        it('should fallback to secondary if primary fails', async () => {
            const primary = createMockProvider('primary', 100, true);
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(primary, secondary);

            const quotes = await engine.getQuotes(['AAPL']);
            assert.ok(quotes['AAPL']);
            assert.strictEqual(quotes['AAPL'].price, 200);
        });

        it('should use secondary if primary is not provided', async () => {
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(undefined, secondary);

            const quotes = await engine.getQuotes(['AAPL']);
            assert.ok(quotes['AAPL']);
            assert.strictEqual(quotes['AAPL'].price, 200);
        });

        it('should return empty object if both fail', async () => {
            const primary = createMockProvider('primary', 100, true);
            const secondary = createMockProvider('secondary', 200, true);
            const engine = new MarketDataEngine(primary, secondary);

            const quotes = await engine.getQuotes(['AAPL']);
            assert.deepStrictEqual(quotes, {});
        });
    });

    describe('getHistoricalData', () => {
        it('should use primary provider if available and successful', async () => {
            const primary = createMockProvider('primary', 100);
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(primary, secondary);

            const data = await engine.getHistoricalData('AAPL', '1D');
            assert.strictEqual(data.length, 1);
            assert.strictEqual(data[0].close, 105); // 100 + 5
        });

        it('should fallback to secondary if primary fails', async () => {
            const primary = createMockProvider('primary', 100, true);
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(primary, secondary);

            const data = await engine.getHistoricalData('AAPL', '1D');
            assert.strictEqual(data.length, 1);
            assert.strictEqual(data[0].close, 205); // 200 + 5
        });

        it('should use secondary if primary is not provided', async () => {
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(undefined, secondary);

            const data = await engine.getHistoricalData('AAPL', '1D');
            assert.strictEqual(data.length, 1);
            assert.strictEqual(data[0].close, 205); // 200 + 5
        });

        it('should return empty array if both fail', async () => {
            const primary = createMockProvider('primary', 100, true);
            const secondary = createMockProvider('secondary', 200, true);
            const engine = new MarketDataEngine(primary, secondary);

            const data = await engine.getHistoricalData('AAPL', '1D');
            assert.deepStrictEqual(data, []);
        });
    });
});
