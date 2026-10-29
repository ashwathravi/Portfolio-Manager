import { z } from 'zod';

/**
 * Plaid's IDs for an Item and its accounts: opaque, but always letters,
 * digits, hyphens and underscores (launch item i44).
 */
export const plaidIdSchema = z.string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/, 'must be a Plaid ID');

/** Most accounts one institution login has, with room to spare. */
export const MAX_PLAID_ACCOUNTS_PER_ITEM = 100;

/**
 * POST /api/plaid/sync: sync one linked connection. With `plaidAccountIds`
 * (the accounts picked after Link), those of its accounts sync from now on
 * and the rest don't. With `reconnected` (after Link's update mode, launch
 * item i45), the connection's state is read from Plaid again first: which
 * accounts it may still read, and whether its login and consent are fine.
 */
export const plaidSyncSchema = z.object({
    itemId: plaidIdSchema,
    plaidAccountIds: z.array(plaidIdSchema).max(MAX_PLAID_ACCOUNTS_PER_ITEM, `At most ${MAX_PLAID_ACCOUNTS_PER_ITEM} accounts`).optional(),
    reconnected: z.literal(true).optional(),
}).strict();

export type PlaidSyncBody = z.infer<typeof plaidSyncSchema>;

/**
 * What Plaid Link reports in the browser after a sign-in, as the page sends
 * it with the public token: the institution and the accounts picked. The
 * browser can send anything, so only these fields, as strings within these
 * lengths, are kept (launch item i69); Plaid's other fields are dropped.
 * The institution's ID is taken from Plaid's own answer when it gives one
 * (src/lib/plaid/link.ts).
 */
export const plaidLinkMetadataSchema = z.object({
    institution: z.object({
        name: z.string().trim().max(100).nullish(),
        institution_id: plaidIdSchema.nullish(),
    }).nullish(),
    accounts: z.array(z.object({
        id: plaidIdSchema,
        name: z.string().max(200),
        mask: z.string().max(8).nullish(),
        type: z.string().max(40).nullish(),
        subtype: z.string().max(60).nullish(),
        verification_status: z.string().max(60).nullish(),
    })).max(MAX_PLAID_ACCOUNTS_PER_ITEM).optional(),
    link_session_id: z.string().max(128).nullish(),
});

/** Bytes POST /api/plaid/exchange-public-token reads: a token and Link's metadata. */
export const PLAID_EXCHANGE_MAX_BYTES = 64 * 1024;
