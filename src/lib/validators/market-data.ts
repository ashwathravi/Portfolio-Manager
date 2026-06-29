import { z } from 'zod';
import { safeText } from './common';

export const MAX_MARKET_DATA_SYMBOLS = 100;

export const tickerSchema = z.string()
    .min(1, "Ticker is required")
    .max(10, "Ticker symbol too long")
    .regex(/^[A-Z0-9.]+$/, "Ticker must be uppercase alphanumeric or dots")
    .pipe(safeText);

export const symbolsSchema = z.string()
    .min(1, "Symbols parameter is required")
    .transform((val) => val.split(',').map(s => s.trim().toUpperCase()))
    .pipe(z.array(tickerSchema)
        .nonempty("At least one valid symbol is required")
        .max(MAX_MARKET_DATA_SYMBOLS, `At most ${MAX_MARKET_DATA_SYMBOLS} symbols are allowed`));

export const timeframeSchema = z.enum(['1D', '1H', '1M']);
export const historyRangeSchema = z.enum(['1D', '5D', '1M', '3M', '6M', '1Y', '5Y', 'MAX']);
export const marketSearchQuerySchema = z.string()
    .trim()
    .min(1, "Search query is required")
    .max(80, "Search query is too long")
    .pipe(safeText);
