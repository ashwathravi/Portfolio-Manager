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
    // Removed: an example, kept so it isn't shown again, or the user's own,
    // kept (with its text cleared) so a late save can't bring it back.
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

/**
 * PUT /api/research/watchlist/[id]: the item, and the order of the write.
 * Removing an item is a PUT with `dismissed: true`, so a removal is ordered
 * like any other write.
 */
export const watchItemPutSchema = z.object({
    item: watchItemSchema,
    order: watchWriteOrderSchema,
}).strict();

/**
 * The PUT route's body limit: room for the largest item the schema allows,
 * with every character of its text JSON-escaped (6 bytes each), and still
 * under browsers' 64 KiB keepalive limit.
 */
export const WATCH_ITEM_PUT_MAX_BYTES = 48 * 1024;

/**
 * POST /api/research/watchlist/import. A list too big for one request comes
 * in batches: `first` is the position of this batch's first item in the
 * whole list and `startedAt` (ms) when the move began, so every batch is
 * ordered as one list.
 */
export const watchlistImportSchema = z.object({
    items: z.array(watchItemSchema).max(WATCHLIST_IMPORT_MAX_ITEMS, 'at most 500 items'),
    first: z.number().int('first must be a whole number').min(0, 'first must be 0 or more').max(1_000_000, 'first is too large').default(0),
    startedAt: z.number().int('startedAt must be a time in milliseconds').positive('startedAt must be a time in milliseconds').optional(),
}).strict();

export type WatchlistImport = z.infer<typeof watchlistImportSchema>;
