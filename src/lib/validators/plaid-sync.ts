import { z } from 'zod';

/**
 * Plaid's IDs for an Item and its accounts: opaque, but always letters,
 * digits, hyphens and underscores (launch item i44).
 */
const plaidIdSchema = z.string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/, 'must be a Plaid ID');

/** Most accounts one institution login has, with room to spare. */
export const MAX_PLAID_ACCOUNTS_PER_ITEM = 100;

/**
 * POST /api/plaid/sync: sync one linked connection. With `plaidAccountIds`
 * (the accounts picked after Link), those of its accounts sync from now on
 * and the rest don't.
 */
export const plaidSyncSchema = z.object({
    itemId: plaidIdSchema,
    plaidAccountIds: z.array(plaidIdSchema).max(MAX_PLAID_ACCOUNTS_PER_ITEM, `At most ${MAX_PLAID_ACCOUNTS_PER_ITEM} accounts`).optional(),
}).strict();

export type PlaidSyncBody = z.infer<typeof plaidSyncSchema>;
