import { z } from 'zod';

import { SYMBOL_TYPES, TRADE_TYPES, TRANSACTION_TYPES } from '@/lib/portfolio/transactions';
import { safeText } from './common';
import { tickerSchema } from './market-data';

/**
 * Transactions as the browser sends them (launch item i40): one, entered by
 * hand, or the rows of a CSV import. Trades need a symbol, quantity and
 * price; dividends a symbol and an amount; cash movements an amount.
 */

export const TRANSACTION_LIMITS = { notes: 500, externalId: 128, importRows: 2000 } as const;

const money = (name: string) => z.number({ message: `${name} must be a number` })
    .finite(`${name} must be a number`)
    .min(0, `${name} can't be negative`)
    .max(1e12, `${name} is out of range`);

export const transactionRowSchema = z.object({
    type: z.enum(TRANSACTION_TYPES, { message: 'type must be one of ' + TRANSACTION_TYPES.join(', ') }),
    date: z.iso.date({ message: 'date must be a date (YYYY-MM-DD)' }),
    symbol: tickerSchema.nullable().optional(),
    quantity: z.number({ message: 'quantity must be a number' }).finite().positive('quantity must be more than 0').max(1e12).nullable().optional(),
    price: money('price').nullable().optional(),
    amount: money('amount').nullable().optional(),
    fees: money('fees').nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be a three-letter code such as USD').default('USD'),
    notes: safeText.trim().max(TRANSACTION_LIMITS.notes, 'notes must be at most 500 characters').nullable().optional(),
    // The source's own ID for it, when it has one.
    externalId: z.string().trim().min(1).max(TRANSACTION_LIMITS.externalId, 'externalId must be at most 128 characters')
        .regex(/^[^\p{Cc}]*$/u, 'externalId must be printable text').optional(),
}).strict()
    .refine((row) => !SYMBOL_TYPES.has(row.type) || Boolean(row.symbol), { message: 'Buys, sells and dividends need a symbol', path: ['symbol'] })
    .refine((row) => !TRADE_TYPES.has(row.type) || (row.quantity != null && row.price != null), { message: 'Buys and sells need a quantity and a price', path: ['quantity'] })
    .refine((row) => TRADE_TYPES.has(row.type) || (row.amount != null && row.amount > 0), { message: 'Enter the amount', path: ['amount'] })
    .refine((row) => TRADE_TYPES.has(row.type) || row.quantity == null || row.type === 'DIVIDEND', { message: 'Only buys, sells and dividends have a quantity', path: ['quantity'] });

export type TransactionRow = z.infer<typeof transactionRowSchema>;

/** POST /api/transactions: one transaction, into one of the user's accounts. */
export const transactionCreateSchema = z.object({
    portfolioId: z.guid('Choose an account'),
    transaction: transactionRowSchema,
}).strict();

/** POST /api/transactions/import: a CSV's rows, into one of the user's accounts. */
export const transactionImportSchema = z.object({
    portfolioId: z.guid('Choose an account'),
    rows: z.array(transactionRowSchema).min(1, 'Nothing to import')
        .max(TRANSACTION_LIMITS.importRows, `Import at most ${TRANSACTION_LIMITS.importRows} transactions at once`),
}).strict();
