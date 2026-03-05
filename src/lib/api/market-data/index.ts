import { AlphaVantageProvider, alphaVantageProvider } from './alpha-vantage';

export interface MarketQuote {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    timestamp: number;
}

export interface HistoricalBar {
    time: string; // ISO string or timestamp
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface MarketDataProvider {
    name: string;

    /**
     * Fetches latest real-time or delayed quote for the given symbols.
     */
    getQuotes(symbols: string[]): Promise<Record<string, MarketQuote>>;

    /**
     * Fetches historical price bars for chart rendering and backtesting.
     */
    getHistoricalData(symbol: string, timeframe: '1D' | '1H' | '1M', limit?: number): Promise<HistoricalBar[]>;
}

/**
 * Service orchestrator that routes requests to the optimal market data provider.
 */
export class MarketDataEngine {
    private primaryProvider?: MarketDataProvider;
    private secondaryProvider: MarketDataProvider;

    constructor(
        primaryProvider?: MarketDataProvider,
        secondaryProvider: MarketDataProvider = alphaVantageProvider
    ) {
        this.primaryProvider = primaryProvider;
        this.secondaryProvider = secondaryProvider;
    }

    async getQuotes(symbols: string[]): Promise<Record<string, MarketQuote>> {
        if (this.primaryProvider) {
            try {
                return await this.primaryProvider.getQuotes(symbols);
            } catch (err) {
                console.warn(`Primary provider failed to fetch quotes: ${err}. Falling back to secondary.`);
            }
        }

        try {
            return await this.secondaryProvider.getQuotes(symbols);
        } catch (err) {
            console.error(`Secondary provider failed to fetch quotes: ${err}. Returning empty quotes.`);
            return {};
        }
    }

    async getHistoricalData(symbol: string, timeframe: '1D' | '1H' | '1M'): Promise<HistoricalBar[]> {
        if (this.primaryProvider) {
            try {
                return await this.primaryProvider.getHistoricalData(symbol, timeframe);
            } catch (err) {
                console.warn(`Primary provider failed to fetch historical data: ${err}. Falling back to secondary.`);
            }
        }

        try {
            return await this.secondaryProvider.getHistoricalData(symbol, timeframe);
        } catch (err) {
            console.error(`Secondary provider failed to fetch historical data for ${symbol}: ${err}. Returning empty data.`);
            return [];
        }
    }
}

export const marketDataEngine = new MarketDataEngine();
