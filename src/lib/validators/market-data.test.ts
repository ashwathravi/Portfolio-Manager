import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    MAX_MARKET_DATA_SYMBOLS,
    historyRangeSchema,
    marketSearchQuerySchema,
    tickerSchema,
    symbolsSchema,
    timeframeSchema,
} from './market-data';

describe('market-data validators', () => {
    describe('tickerSchema', () => {
        test('should accept valid tickers', () => {
            const valid = ['AAPL', 'TSLA', 'BRK.B', 'GOOGL', 'AMZN'];
            for (const ticker of valid) {
                const result = tickerSchema.safeParse(ticker);
                assert.strictEqual(result.success, true, `Failed for ${ticker}`);
            }
        });

        test('should reject invalid characters', () => {
            const invalid = ['AAPL!', 'TSLA$', 'GOOG<', 'MSFT>', 'META='];
            for (const ticker of invalid) {
                const result = tickerSchema.safeParse(ticker);
                assert.strictEqual(result.success, false, `Accepted invalid ticker ${ticker}`);
            }
        });

        test('should reject tickers that are too long', () => {
            const invalid = 'VERYLONGTICKER';
            const result = tickerSchema.safeParse(invalid);
            assert.strictEqual(result.success, false);
        });

        test('should reject empty ticker', () => {
            const result = tickerSchema.safeParse('');
            assert.strictEqual(result.success, false);
        });
    });

    describe('symbolsSchema', () => {
        test('should parse valid comma-separated symbols', () => {
            const input = 'AAPL, TSLA, MSFT';
            const result = symbolsSchema.safeParse(input);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.deepStrictEqual(result.data, ['AAPL', 'TSLA', 'MSFT']);
            }
        });

        test('should handle single symbol', () => {
            const input = 'AAPL';
            const result = symbolsSchema.safeParse(input);
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.deepStrictEqual(result.data, ['AAPL']);
            }
        });

        test('should reject if any symbol is invalid', () => {
            const input = 'AAPL, TSLA!, MSFT';
            const result = symbolsSchema.safeParse(input);
            assert.strictEqual(result.success, false);
        });

        test('should reject empty input', () => {
            const result = symbolsSchema.safeParse('');
            assert.strictEqual(result.success, false);
        });

        test('should cap batch size', () => {
            const input = Array.from({ length: MAX_MARKET_DATA_SYMBOLS + 1 }, (_, i) => `S${i}`).join(',');
            const result = symbolsSchema.safeParse(input);
            assert.strictEqual(result.success, false);
        });

        test('should reject null or undefined', () => {
            assert.strictEqual(symbolsSchema.safeParse(null).success, false);
            assert.strictEqual(symbolsSchema.safeParse(undefined).success, false);
        });
    });

    describe('timeframeSchema', () => {
        test('should accept valid timeframes', () => {
            const valid = ['1D', '1H', '1M'];
            for (const tf of valid) {
                const result = timeframeSchema.safeParse(tf);
                assert.strictEqual(result.success, true);
            }
        });

        test('should reject invalid timeframes', () => {
            const invalid = ['1S', '5M', 'DAILY', ''];
            for (const tf of invalid) {
                const result = timeframeSchema.safeParse(tf);
                assert.strictEqual(result.success, false);
            }
        });
    });

    describe('historyRangeSchema', () => {
        test('should accept supported chart ranges', () => {
            for (const range of ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y', 'MAX']) {
                assert.strictEqual(historyRangeSchema.safeParse(range).success, true, `${range} should be valid`);
            }
        });

        test('should reject unsupported chart ranges', () => {
            for (const range of ['2D', '10Y', 'ALL', '']) {
                assert.strictEqual(historyRangeSchema.safeParse(range).success, false, `${range} should be invalid`);
            }
        });
    });

    describe('marketSearchQuerySchema', () => {
        test('should trim safe search text', () => {
            const result = marketSearchQuerySchema.safeParse('  apple  ');
            assert.strictEqual(result.success, true);
            if (result.success) assert.strictEqual(result.data, 'apple');
        });

        test('should reject unsafe or excessively long search text', () => {
            assert.strictEqual(marketSearchQuerySchema.safeParse('<script>').success, false);
            assert.strictEqual(marketSearchQuerySchema.safeParse('a'.repeat(81)).success, false);
        });
    });
});
