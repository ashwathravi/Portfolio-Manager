import { z } from 'zod';
import { safeText } from './common';
import { tickerSchema } from './market-data';
import { manualImportKey, MAX_IMPORT_ROWS } from '@/lib/portfolio/csvImport';
import { manualHoldingSchema } from './manual-holding';
import { optionImportRowsSchema } from './option-position';

/**
 * POST /api/portfolio/import body. Rows arrive already parsed by the client
 * (so the user previews exactly what is sent) and are re-validated here.
 * Exactly one destination: an existing account the user owns, or a name for
 * a new one. `options` are the file's option rows (launch item i63), for the
 * LEAPS ledger. `manual` are the file's rows with no ticker Atlas can price,
 * brought in valued by hand, and `valuesAsOf` the day their values are from
 * (today in UTC when it's left out). Positions and holdings valued by hand
 * share the one-file limit.
 */
export const importRowSchema = z.object({
    symbol: tickerSchema,
    name: safeText.max(120, 'Name is too long').optional().default(''),
    quantity: z.number().finite().positive('Quantity must be positive').max(1e12),
    avgCost: z.number().finite().min(0, 'Average cost cannot be negative').max(1e9),
});

/**
 * A row with no ticker, as a holding valued by hand: the card's fields and
 * limits without its date, which is the body's `valuesAsOf`. It needs a
 * name or an identifier the next file can find it by (manualImportKey).
 */
export const manualImportRowSchema = manualHoldingSchema.omit({ valueAsOf: true })
    .refine((r) => manualImportKey(r) !== null, { message: 'Name the holding', path: ['name'] });

/**
 * The latest day a file's values can be from: tomorrow in UTC, which is
 * already today in the time zones furthest ahead.
 */
export function latestValueDate(now: Date = new Date()): string {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const valuesDateMessage = 'Enter the date of the values (YYYY-MM-DD)';

export const portfolioImportSchema = z
    .object({
        portfolioId: z.guid('Unknown account').optional(),
        newPortfolioName: safeText.trim().min(1, 'Name the new account').max(80, 'Account name is too long').optional(),
        rows: z
            .array(importRowSchema)
            .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} positions at once`),
        options: optionImportRowsSchema.default([]),
        manual: z
            .array(manualImportRowSchema)
            .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} positions at once`)
            .default([]),
        // Postgres has no year 0000, which the ISO format allows.
        valuesAsOf: z.iso.date({ message: valuesDateMessage })
            .refine((date) => date >= '0001-01-01', valuesDateMessage)
            .refine((date) => date <= latestValueDate(), "The values can't be from a future date")
            .optional(),
    })
    .refine((b) => b.rows.length + b.options.length + b.manual.length > 0, { message: 'Nothing to import', path: ['rows'] })
    .refine((b) => Boolean(b.portfolioId) !== Boolean(b.newPortfolioName), {
        message: 'Choose an existing account or name a new one',
        path: ['portfolioId'],
    })
    .refine((b) => new Set(b.rows.map((r) => r.symbol)).size === b.rows.length, {
        message: 'Each symbol can appear only once',
        path: ['rows'],
    })
    .refine((b) => b.rows.length + b.manual.length <= MAX_IMPORT_ROWS, {
        message: `Import at most ${MAX_IMPORT_ROWS} positions at once`,
        path: ['manual'],
    })
    .refine((b) => new Set(b.manual.map((r) => manualImportKey(r))).size === b.manual.length, {
        message: 'Each holding valued by hand can appear only once',
        path: ['manual'],
    });

export type PortfolioImportBody = z.infer<typeof portfolioImportSchema>;

/** How many accounts one multi-account import may write. */
export const MAX_IMPORT_ACCOUNTS = 50;

/**
 * POST /api/portfolio/import with `accounts`: a positions export covering
 * several accounts, each group going to an account the user owns or a new
 * one, all written together or none. Positions and holdings valued by hand
 * across the groups share the one-file limit.
 */
export const portfolioMultiImportSchema = z
    .object({
        accounts: z.array(portfolioImportSchema)
            .min(1, 'Nothing to import')
            .max(MAX_IMPORT_ACCOUNTS, `Import at most ${MAX_IMPORT_ACCOUNTS} accounts at once`),
    })
    .strict()
    .refine((b) => b.accounts.reduce((n, a) => n + a.rows.length + a.manual.length, 0) <= MAX_IMPORT_ROWS, {
        message: `Import at most ${MAX_IMPORT_ROWS} positions at once`,
        path: ['accounts'],
    })
    .refine((b) => {
        const ids = b.accounts.flatMap((a) => (a.portfolioId ? [a.portfolioId] : []));
        return new Set(ids).size === ids.length;
    }, { message: 'Two accounts in the file go to the same Atlas account. Choose a different one for each.', path: ['accounts'] });

export type PortfolioMultiImportBody = z.infer<typeof portfolioMultiImportSchema>;
