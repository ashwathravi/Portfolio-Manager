import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { AlphaVantageProvider } from './alpha-vantage';

describe('AlphaVantageProvider', () => {
    it('should parse success response for getQuotes', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => {
            return {
                ok: true,
                json: async () => ({
                    'Global Quote': {
                        '01. symbol': 'AAPL',
                        '05. price': '150.00',
                        '09. change': '2.00',
                        '10. change percent': '1.35%',
                        '06. volume': '50000000'
                    }
                })
            } as any;
        };

        try {
            const provider = new AlphaVantageProvider('demo');
            const quotes = await provider.getQuotes(['AAPL']);

            assert.ok(quotes['AAPL']);
            assert.strictEqual(quotes['AAPL'].symbol, 'AAPL');
            assert.strictEqual(quotes['AAPL'].price, 150.00);
            assert.strictEqual(quotes['AAPL'].change, 2.00);
            assert.strictEqual(quotes['AAPL'].changePercent, 1.35);
            assert.strictEqual(quotes['AAPL'].volume, 50000000);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should throw error on non-ok fetch response for getQuotes', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => {
            return {
                ok: false,
                statusText: 'Forbidden'
            } as any;
        };

        try {
            const provider = new AlphaVantageProvider('demo');
            await assert.rejects(
                async () => await provider.getQuotes(['AAPL']),
                /Alpha Vantage API error: Forbidden/
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should throw error on non-ok fetch response for getHistoricalData', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => {
            return {
                ok: false,
                statusText: 'Service Unavailable'
            } as any;
        };

        try {
            const provider = new AlphaVantageProvider('demo');
            await assert.rejects(
                async () => await provider.getHistoricalData('AAPL', '1D'),
                /Alpha Vantage API error: Service Unavailable/
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should throw error on rate limit (Information field)', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => {
            return {
                ok: true,
                json: async () => ({
                    'Information': 'Thank you for using Alpha Vantage! Our standard API call frequency is 25 requests per day. Please visit https://www.alphavantage.co/premium/ if you would like to target a higher API call frequency.'
                })
            } as any;
        };

        try {
            const provider = new AlphaVantageProvider('demo');
            await assert.rejects(
                async () => await provider.getQuotes(['AAPL']),
                /Alpha Vantage rate limit exceeded/
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should throw error on rate limit (Note field)', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => {
            return {
                ok: true,
                json: async () => ({
                    'Note': 'Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute and 500 calls per day. Please visit https://www.alphavantage.co/premium/ if you would like to target a higher API call frequency.'
                })
            } as any;
        };

        try {
            const provider = new AlphaVantageProvider('demo');
            await assert.rejects(
                async () => await provider.getHistoricalData('AAPL', '1D'),
                /Alpha Vantage rate limit exceeded/
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('returns empty quotes without fetching when no api key is configured', async () => {
        const originalFetch = global.fetch;
        let fetchCalled = false;
        global.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } as any; };
        try {
            const provider = new AlphaVantageProvider('');
            const quotes = await provider.getQuotes(['AAPL', 'MSFT']);
            assert.deepStrictEqual(quotes, {});
            assert.strictEqual(fetchCalled, false);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('returns empty bars without fetching when no api key is configured', async () => {
        const originalFetch = global.fetch;
        let fetchCalled = false;
        global.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) } as any; };
        try {
            const provider = new AlphaVantageProvider('');
            const bars = await provider.getHistoricalData('AAPL', '1D');
            assert.deepStrictEqual(bars, []);
            assert.strictEqual(fetchCalled, false);
        } finally {
            global.fetch = originalFetch;
        }
    });

    it('should parse success response for getHistoricalData', async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => {
            return {
                ok: true,
                json: async () => ({
                    'Time Series (Daily)': {
                        '2024-03-01': {
                            '1. open': '148.00',
                            '2. high': '151.00',
                            '3. low': '147.50',
                            '4. close': '150.00',
                            '5. volume': '60000000'
                        },
                        '2024-02-29': {
                            '1. open': '145.00',
                            '2. high': '149.00',
                            '3. low': '144.50',
                            '4. close': '148.50',
                            '5. volume': '55000000'
                        }
                    }
                })
            } as any;
        };

        try {
            const provider = new AlphaVantageProvider('demo');
            const bars = await provider.getHistoricalData('AAPL', '1D', 2);

            assert.strictEqual(bars.length, 2);
            // It reverses the array to return chronological order
            assert.strictEqual(bars[0].time, '2024-02-29');
            assert.strictEqual(bars[0].close, 148.50);

            assert.strictEqual(bars[1].time, '2024-03-01');
            assert.strictEqual(bars[1].close, 150.00);
        } finally {
            global.fetch = originalFetch;
        }
    });
});
