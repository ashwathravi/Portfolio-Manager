import { z } from 'zod';

/**
 * IDs of research records the browser makes (launch item i38): a UUID, or an
 * example's fixed ID such as `w-coin` or `seed-journal-1`.
 */
export const recordIdSchema = z.string()
    .regex(/^[a-z0-9][a-z0-9.-]{0,63}$/, 'id must be lowercase letters, digits, dots and hyphens');

/**
 * Which page sent a write to a research record, and its count of writes so
 * far: of two writes from one page, the newer wins even if it arrives first.
 */
export const writeOrderSchema = z.object({
    session: z.string().regex(/^[a-z0-9-]{8,64}$/, 'session must be a page ID'),
    seq: z.number().int('seq must be a whole number').min(1, 'seq must be at least 1').max(Number.MAX_SAFE_INTEGER, 'seq is too large'),
}).strict();

export type WriteOrder = z.infer<typeof writeOrderSchema>;

/**
 * For import routes: a list too big for one request comes in batches.
 * `first` is the position of the batch's first item in the whole list and
 * `startedAt` (ms) when the move began, so every batch is ordered as one list.
 */
export const importPositionFields = {
    first: z.number().int('first must be a whole number').min(0, 'first must be 0 or more').max(1_000_000, 'first is too large').default(0),
    startedAt: z.number().int('startedAt must be a time in milliseconds').positive('startedAt must be a time in milliseconds').optional(),
};
