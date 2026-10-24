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

export const watchlistImportSchema = z.object({
    items: z.array(watchItemSchema).max(WATCHLIST_IMPORT_MAX_ITEMS, 'at most 500 items'),
}).strict();
