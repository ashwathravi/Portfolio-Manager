import { z } from 'zod';

import { importPositionFields, recordIdSchema, writeOrderSchema } from '@/lib/validators/research-ids';

/**
 * Decision-journal entries as the browser sends them (launch item i38): one
 * to PUT /api/research/journal/[id], or this browser's journal to import
 * once.
 */

export const JOURNAL_ENTRY_LIMITS = { ticker: 20, decision: 500, rationale: 5000 } as const;
export const JOURNAL_IMPORT_MAX_ENTRIES = 500;

// Printable text: no control characters.
const NO_CONTROL = /^[^\p{Cc}]*$/u;

export const journalEntrySchema = z.object({
    id: recordIdSchema,
    date: z.iso.date({ message: 'date must be a date (YYYY-MM-DD)' }),
    type: z.enum(['entry', 'exit', 'hold'], { message: 'type must be entry, exit or hold' }),
    ticker: z.string().trim()
        .min(1, 'ticker is required')
        .max(JOURNAL_ENTRY_LIMITS.ticker, 'ticker must be at most 20 characters')
        .regex(NO_CONTROL, 'ticker must be printable text'),
    decision: z.string().trim()
        .min(1, 'decision is required')
        .max(JOURNAL_ENTRY_LIMITS.decision, 'decision must be at most 500 characters'),
    rationale: z.string().trim()
        .min(1, 'rationale is required')
        .max(JOURNAL_ENTRY_LIMITS.rationale, 'rationale must be at most 5000 characters'),
    outcome: z.enum(['win', 'loss', 'pending'], { message: 'outcome must be win, loss or pending' }),
    // The thesis it was made under, by ID; null when none.
    thesisId: z.string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'thesisId must be a thesis ID')
        .nullable(),
    // Deleted: an example, kept so it isn't shown again, or the user's own,
    // kept (with its text cleared) so a late save can't bring it back.
    dismissed: z.boolean().default(false),
}).strict();

export type JournalEntryInput = z.infer<typeof journalEntrySchema>;

/**
 * PUT /api/research/journal/[id]: the entry, and the order of the write.
 * Deleting an entry is a PUT with `dismissed: true`, ordered like any other
 * write.
 */
export const journalEntryPutSchema = z.object({
    entry: journalEntrySchema,
    order: writeOrderSchema,
}).strict();

/**
 * The PUT route's body limit: room for the largest entry the schema allows,
 * with every character of its text JSON-escaped (6 bytes each), and still
 * under browsers' 64 KiB keepalive limit.
 */
export const JOURNAL_ENTRY_PUT_MAX_BYTES = 48 * 1024;

/** POST /api/research/journal/import: one batch of a browser's journal. */
export const journalImportSchema = z.object({
    items: z.array(journalEntrySchema).max(JOURNAL_IMPORT_MAX_ENTRIES, 'at most 500 entries'),
    ...importPositionFields,
}).strict();
