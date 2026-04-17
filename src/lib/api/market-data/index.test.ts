import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { MarketDataEngine } from './index';
import type { MarketDataProvider, MarketQuote, HistoricalBar } from './index';

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
    getHistoricalData: async (symbol: string, timeframe: '1D' | '1H' | '1M'): Promise<HistoricalBar[]> => {
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

        it('should fallback to secondary if primary fails and log warning', async (t) => {
            const warnMock = t.mock.method(console, 'warn', () => {});
            const primary = createMockProvider('primary', 100, true);
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(primary, secondary);

            const quotes = await engine.getQuotes(['AAPL']);
            assert.ok(quotes['AAPL']);
            assert.strictEqual(quotes['AAPL'].price, 200);

            assert.strictEqual(warnMock.mock.callCount(), 1);
            assert.match(warnMock.mock.calls[0].arguments[0], /Primary provider failed to fetch quotes: Error: primary failed/);
        });

        it('should use secondary if primary is not provided', async () => {
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(undefined, secondary);

            const quotes = await engine.getQuotes(['AAPL']);
            assert.ok(quotes['AAPL']);
            assert.strictEqual(quotes['AAPL'].price, 200);
        });

        it('should return empty object and log error if both fail', async (t) => {
            const errorMock = t.mock.method(console, 'error', () => {});
            const primary = createMockProvider('primary', 100, true);
            const secondary = createMockProvider('secondary', 200, true);
            const engine = new MarketDataEngine(primary, secondary);

            const quotes = await engine.getQuotes(['AAPL']);
            assert.deepStrictEqual(quotes, {});

            assert.strictEqual(errorMock.mock.callCount(), 1);
            assert.match(errorMock.mock.calls[0].arguments[0], /Secondary provider failed to fetch quotes: Error: secondary failed/);
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

        it('should fallback to secondary if primary fails and log warning', async (t) => {
            const warnMock = t.mock.method(console, 'warn', () => {});
            const primary = createMockProvider('primary', 100, true);
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(primary, secondary);

            const data = await engine.getHistoricalData('AAPL', '1D');
            assert.strictEqual(data.length, 1);
            assert.strictEqual(data[0].close, 205); // 200 + 5

            assert.strictEqual(warnMock.mock.callCount(), 1);
            assert.match(warnMock.mock.calls[0].arguments[0], /Primary provider failed to fetch historical data: Error: primary failed/);
        });

        it('should use secondary if primary is not provided', async () => {
            const secondary = createMockProvider('secondary', 200);
            const engine = new MarketDataEngine(undefined, secondary);

            const data = await engine.getHistoricalData('AAPL', '1D');
            assert.strictEqual(data.length, 1);
            assert.strictEqual(data[0].close, 205); // 200 + 5
        });

        it('should return empty array and log error if both fail', async (t) => {
            const errorMock = t.mock.method(console, 'error', () => {});
            const primary = createMockProvider('primary', 100, true);
            const secondary = createMockProvider('secondary', 200, true);
            const engine = new MarketDataEngine(primary, secondary);

            const data = await engine.getHistoricalData('AAPL', '1D');
            assert.deepStrictEqual(data, []);

            assert.strictEqual(errorMock.mock.callCount(), 1);
            assert.match(errorMock.mock.calls[0].arguments[0], /Secondary provider failed to fetch historical data for AAPL: Error: secondary failed/);
        });
    });
});
