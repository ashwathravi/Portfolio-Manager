import { z } from 'zod';
import { safeText } from './common';
import { tickerSchema } from './market-data';
import { MAX_IMPORT_ROWS } from '@/lib/portfolio/csvImport';

/**
 * POST /api/portfolio/import body. Rows arrive already parsed by the client
 * (so the user previews exactly what is sent) and are re-validated here.
 * Exactly one destination: an existing account the user owns, or a name for
 * a new one.
 */
export const importRowSchema = z.object({
    symbol: tickerSchema,
    name: safeText.max(120, 'Name is too long').optional().default(''),
    quantity: z.number().finite().positive('Quantity must be positive').max(1e12),
    avgCost: z.number().finite().min(0, 'Average cost cannot be negative').max(1e9),
});

export const portfolioImportSchema = z
    .object({
        portfolioId: z.uuid('Unknown account').optional(),
        newPortfolioName: safeText.trim().min(1, 'Name the new account').max(80, 'Account name is too long').optional(),
        rows: z
            .array(importRowSchema)
            .min(1, 'Nothing to import')
            .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} positions at once`),
    })
    .refine((b) => Boolean(b.portfolioId) !== Boolean(b.newPortfolioName), {
        message: 'Choose an existing account or name a new one',
        path: ['portfolioId'],
    })
    .refine((b) => new Set(b.rows.map((r) => r.symbol)).size === b.rows.length, {
        message: 'Each symbol can appear only once',
        path: ['rows'],
    });

export type PortfolioImportBody = z.infer<typeof portfolioImportSchema>;
