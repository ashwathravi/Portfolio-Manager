import { z } from 'zod';

import { tickerSchema } from '@/lib/validators/market-data';

/**
 * Watchlist rows as the browser sends them (launch item i38): one item to
 * PUT /api/research/watchlist/[id], or this browser's list to import once.
 */

export const WATCH_ITEM_LIMITS = { companyName: 200, reason: 500, notes: 5000 } as const;
export const WATCHLIST_IMPORT_MAX_ITEMS = 500;

const ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;

export const watchItemSchema = z.object({
    id: z.string().regex(ID, 'id must be lowercase letters, digits, dots and hyphens'),
    ticker: tickerSchema,
    companyName: z.string().trim().max(WATCH_ITEM_LIMITS.companyName, 'companyName must be at most 200 characters'),
    reason: z.string().trim().max(WATCH_ITEM_LIMITS.reason, 'reason must be at most 500 characters'),
    notes: z.string().max(WATCH_ITEM_LIMITS.notes, 'notes must be at most 5000 characters'),
    targetEntry: z.number().positive('targetEntry must be a positive price').finite().nullable(),
    addedAt: z.iso.date({ message: 'addedAt must be a date (YYYY-MM-DD)' }),
    // An example the user removed, kept so it isn't shown again.
    dismissed: z.boolean().default(false),
}).strict();

export type WatchItemInput = z.infer<typeof watchItemSchema>;

/**
 * Which page sent a write, and its count of writes so far: of two writes
 * from one page, the newer wins even if it arrives first.
 */
export const watchWriteOrderSchema = z.object({
    session: z.string().regex(/^[a-z0-9-]{8,64}$/, 'session must be a page ID'),
    seq: z.number().int('seq must be a whole number').min(1, 'seq must be at least 1').max(Number.MAX_SAFE_INTEGER, 'seq is too large'),
}).strict();

export type WatchWriteOrder = z.infer<typeof watchWriteOrderSchema>;

/** PUT /api/research/watchlist/[id]: the item, and the order of the write. */
export const watchItemPutSchema = z.object({
    item: watchItemSchema,
    order: watchWriteOrderSchema,
}).strict();

/** DELETE /api/research/watchlist/[id]: the order of the write. */
export const watchItemDeleteSchema = z.object({
    order: watchWriteOrderSchema,
}).strict();

export const watchlistImportSchema = z.object({
    items: z.array(watchItemSchema).max(WATCHLIST_IMPORT_MAX_ITEMS, 'at most 500 items'),
}).strict();
