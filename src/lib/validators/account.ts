import { z } from 'zod';

/**
 * DELETE /api/account (launch item i65): the user typed DELETE, and the
 * request says so, so no stray request can delete an account.
 */
export const accountDeletionSchema = z.object({
    confirm: z.literal('DELETE', { message: 'Type DELETE to confirm' }),
}).strict();
