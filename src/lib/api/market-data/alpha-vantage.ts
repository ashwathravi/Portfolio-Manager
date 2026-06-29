import { type MarketDataProvider, type MarketQuote, type HistoricalBar } from './index';

export class AlphaVantageProvider implements MarketDataProvider {
    name = 'AlphaVantage';
    private apiKey: string;
    private baseUrl = 'https://www.alphavantage.co/query';
    private quoteConcurrency: number;

    constructor(
        apiKey = process.env.ALPHA_VANTAGE_API_KEY || '',
        options: { quoteConcurrency?: number } = {},
    ) {
        this.apiKey = apiKey;
        this.quoteConcurrency = Math.max(1, Math.floor(options.quoteConcurrency ?? 5));
    }

    async getQuotes(symbols: string[]): Promise<Record<string, MarketQuote>> {
        const quotes: Record<string, MarketQuote> = {};

        // No key configured — behave as a no-op provider instead of burning
        // requests that AV will reject with "apikey is invalid or missing".
        if (!this.apiKey) return quotes;

        await runWithConcurrency(symbols, this.quoteConcurrency, async (symbol) => {
            const quote = await this.fetchQuote(symbol);
            if (quote) quotes[symbol] = quote;
        });

        return quotes;
    }

    private async fetchQuote(symbol: string): Promise<MarketQuote | undefined> {
        const url = `${this.baseUrl}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Alpha Vantage API error: ${response.statusText}`);
        }

        const data = await response.json() as Record<string, unknown>;
        assertAlphaVantagePayloadOk(data);

        const quoteData = data['Global Quote'];

        if (isRecord(quoteData) && typeof quoteData['01. symbol'] === 'string') {
            return {
                symbol: quoteData['01. symbol'],
                price: parseFloat(String(quoteData['05. price'] ?? '0')),
                change: parseFloat(String(quoteData['09. change'] ?? '0')),
                changePercent: parseFloat(String(quoteData['10. change percent'] ?? '0').replace('%', '')),
                volume: parseInt(String(quoteData['06. volume'] ?? '0'), 10),
                timestamp: Date.now(), // Approximate as AV doesn't give exact ms here
            };
        }

        return undefined;
    }

    async getHistoricalData(symbol: string, timeframe: '1D' | '1H' | '1M', limit: number = 100): Promise<HistoricalBar[]> {
        if (!this.apiKey) return [];

        let functionName = 'TIME_SERIES_DAILY';
        if (timeframe === '1H' || timeframe === '1M') {
            functionName = 'TIME_SERIES_INTRADAY';
        }

        // For simplicity, sticking to daily data in this skeleton
        const url = `${this.baseUrl}?function=${functionName}&symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Alpha Vantage API error: ${response.statusText}`);
        }

        const data = await response.json() as Record<string, unknown>;

        assertAlphaVantagePayloadOk(data);

        const timeSeries = data['Time Series (Daily)'];

        if (!isRecord(timeSeries)) return [];

        const bars: HistoricalBar[] = [];
        const dates = Object.keys(timeSeries).slice(0, limit);

        for (const date of dates) {
            const barData = timeSeries[date];
            if (!isRecord(barData)) continue;
            bars.push({
                time: date,
                open: parseFloat(String(barData['1. open'] ?? '0')),
                high: parseFloat(String(barData['2. high'] ?? '0')),
                low: parseFloat(String(barData['3. low'] ?? '0')),
                close: parseFloat(String(barData['4. close'] ?? '0')),
                volume: parseInt(String(barData['5. volume'] ?? '0'), 10),
            });
        }

        // Sort chronologically
        return bars.reverse();
    }
}

export const alphaVantageProvider = new AlphaVantageProvider();

function assertAlphaVantagePayloadOk(data: Record<string, unknown>): void {
    const information = typeof data['Information'] === 'string' ? data['Information'] : '';
    const note = typeof data['Note'] === 'string' ? data['Note'] : '';
    if (information && (information.includes('rate limit') || information.includes('API call frequency'))) {
        throw new Error(`Alpha Vantage rate limit exceeded`);
    }
    if (note && note.includes('API call frequency')) {
        throw new Error(`Alpha Vantage rate limit exceeded`);
    }
    if (typeof data['Error Message'] === 'string') {
        throw new Error(`Alpha Vantage API error: ${data['Error Message']}`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function runWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next];
            next += 1;
            await worker(item);
        }
    });
    await Promise.all(workers);
}
