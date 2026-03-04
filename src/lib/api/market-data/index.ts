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
    private secondaryProvider?: MarketDataProvider;

    // We can inject SchwabClient or AlphaVantageClient into providers here

    async getQuotes(symbols: string[]): Promise<Record<string, MarketQuote>> {
        // In a real implementation, we might try primary, and fallback to secondary.
        throw new Error("Not implemented yet");
    }

    async getHistoricalData(symbol: string, timeframe: '1D' | '1H' | '1M'): Promise<HistoricalBar[]> {
        throw new Error("Not implemented yet");
    }
}
