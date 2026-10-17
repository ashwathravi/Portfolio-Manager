/**
 * Client-facing market-data shapes. Server code reads prices through
 * `MarketDataService` (src/lib/services/market-data-service.ts); the client
 * hooks live in ./queries.
 */

export interface HistoricalBar {
    time: string; // ISO string or timestamp
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
