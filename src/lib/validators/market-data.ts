import { z } from 'zod';
import { safeText } from './common';

export const MAX_MARKET_DATA_SYMBOLS = 100;

export const tickerSchema = z.string()
    .min(1, "Ticker is required")
    .max(10, "Ticker symbol too long")
    // Letters/digits joined by single dots or hyphens: AAPL, BRK.B, BTC-USD.
    .regex(/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/, "Ticker must be uppercase letters or digits, optionally joined by dots or hyphens")
    .pipe(safeText);

export const symbolsSchema = z.string()
    .min(1, "Symbols parameter is required")
    .transform((val) => val.split(',').map(s => s.trim().toUpperCase()))
    .pipe(z.array(tickerSchema)
        .nonempty("At least one valid symbol is required")
        .max(MAX_MARKET_DATA_SYMBOLS, `At most ${MAX_MARKET_DATA_SYMBOLS} symbols are allowed`));

/**
 * The legacy /historical route's `timeframe`, a range by another name: the
 * last session (1D) or 30 days (1M) of daily bars. The free plan has no
 * intraday bars, so there is no 1H (x22).
 */
export const timeframeSchema = z.enum(['1D', '1M']);
/**
 * History ranges (/api/market-data/history), each a window of daily bars:
 * 1D and 5D the last one and five sessions, MAX the plan's whole history
 * (PolygonMassiveAdapter's rangeToDates).
 */
export const historyRangeSchema = z.enum(['1D', '5D', '1M', '3M', '6M', '1Y', '5Y', 'MAX']);
export const marketSearchQuerySchema = z.string()
    .trim()
    .min(1, "Search query is required")
    .max(80, "Search query is too long")
    .pipe(safeText);
