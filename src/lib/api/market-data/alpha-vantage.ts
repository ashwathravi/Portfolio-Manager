import { MarketDataProvider, MarketQuote, HistoricalBar } from './index';

export class AlphaVantageProvider implements MarketDataProvider {
    name = 'AlphaVantage';
    private apiKey: string;
    private baseUrl = 'https://www.alphavantage.co/query';

    constructor(apiKey = process.env.ALPHA_VANTAGE_API_KEY || '') {
        this.apiKey = apiKey;
    }

    async getQuotes(symbols: string[]): Promise<Record<string, MarketQuote>> {
        const quotes: Record<string, MarketQuote> = {};

        // Alpha Vantage free tier is heavily rate limited (e.g. 25 requests/day).
        // We fetch them sequentially or in batches if premium.
        for (const symbol of symbols) {
            const url = `${this.baseUrl}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this.apiKey}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Alpha Vantage API error: ${response.statusText}`);
            }

            const data = await response.json();
            const quoteData = data['Global Quote'];

            if (quoteData && quoteData['01. symbol']) {
                quotes[symbol] = {
                    symbol: quoteData['01. symbol'],
                    price: parseFloat(quoteData['05. price']),
                    change: parseFloat(quoteData['09. change']),
                    changePercent: parseFloat(quoteData['10. change percent'].replace('%', '')),
                    volume: parseInt(quoteData['06. volume'], 10),
                    timestamp: Date.now(), // Approximate as AV doesn't give exact ms here
                };
            }
        }

        return quotes;
    }

    async getHistoricalData(symbol: string, timeframe: '1D' | '1H' | '1M', limit: number = 100): Promise<HistoricalBar[]> {
        let functionName = 'TIME_SERIES_DAILY';
        if (timeframe === '1H' || timeframe === '1M') {
            functionName = 'TIME_SERIES_INTRADAY';
        }

        // For simplicity, sticking to daily data in this skeleton
        const url = `${this.baseUrl}?function=${functionName}&symbol=${symbol}&apikey=${this.apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Alpha Vantage API error: ${response.statusText}`);
        }

        const data = await response.json();
        const timeSeries = data['Time Series (Daily)'];

        if (!timeSeries) return [];

        const bars: HistoricalBar[] = [];
        const dates = Object.keys(timeSeries).slice(0, limit);

        for (const date of dates) {
            const barData = timeSeries[date];
            bars.push({
                time: date,
                open: parseFloat(barData['1. open']),
                high: parseFloat(barData['2. high']),
                low: parseFloat(barData['3. low']),
                close: parseFloat(barData['4. close']),
                volume: parseInt(barData['5. volume'], 10),
            });
        }

        // Sort chronologically
        return bars.reverse();
    }
}

export const alphaVantageProvider = new AlphaVantageProvider();
