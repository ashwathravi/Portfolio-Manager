import { z } from 'zod';
import { safeText } from './common';

export const tickerSchema = z.string()
    .min(1, "Ticker is required")
    .max(10, "Ticker symbol too long")
    .regex(/^[A-Z0-9.]+$/, "Ticker must be uppercase alphanumeric or dots")
    .pipe(safeText);

export const symbolsSchema = z.string()
    .min(1, "Symbols parameter is required")
    .transform((val) => val.split(',').map(s => s.trim().toUpperCase()))
    .pipe(z.array(tickerSchema).nonempty("At least one valid symbol is required"));

export const timeframeSchema = z.enum(['1D', '1H', '1M']);
