import { z } from 'zod';

import { tickerSchema } from '@/lib/validators/market-data';
import { importPositionFields, recordIdSchema, writeOrderSchema, type WriteOrder } from '@/lib/validators/research-ids';

/**
 * Watchlist rows as the browser sends them (launch item i38): one item to
 * PUT /api/research/watchlist/[id], or this browser's list to import once.
 */

export const WATCH_ITEM_LIMITS = { companyName: 200, reason: 500, notes: 5000 } as const;
export const WATCHLIST_IMPORT_MAX_ITEMS = 500;

export const watchItemSchema = z.object({
    id: recordIdSchema,
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

export type WatchWriteOrder = WriteOrder;

/**
 * PUT /api/research/watchlist/[id]: the item, and the order of the write.
 * Removing an item is a PUT with `dismissed: true`, so a removal is ordered
 * like any other write.
 */
export const watchItemPutSchema = z.object({
    item: watchItemSchema,
    order: writeOrderSchema,
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
    ...importPositionFields,
}).strict();

export type WatchlistImport = z.infer<typeof watchlistImportSchema>;
