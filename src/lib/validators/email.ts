import { z } from 'zod';

/**
 * Email (launch item i58): the bodies of PUT /api/email/preferences, and
 * what an unsubscribe link carries.
 */

/** The emails one can ask for, and unsubscribe from one at a time. */
export const EMAIL_LISTS = ['alerts', 'weekly_review'] as const;
export type EmailList = (typeof EMAIL_LISTS)[number];

export const EMAIL_PREFERENCES_MAX_BYTES = 1024;

/** One or both switches; the other stays as it was. */
export const emailPreferencesInputSchema = z
    .object({
        alerts: z.boolean().optional(),
        weeklyReview: z.boolean().optional(),
    })
    .strict()
    .refine((input) => input.alerts !== undefined || input.weeklyReview !== undefined, {
        message: 'Send alerts, weeklyReview or both',
    });

export type EmailPreferencesInput = z.infer<typeof emailPreferencesInputSchema>;

/** 32 random bytes, base64url: what src/lib/email/preferences.ts makes. */
export const unsubscribeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid unsubscribe link');

export const unsubscribeSchema = z.object({
    token: unsubscribeTokenSchema,
    list: z.enum(EMAIL_LISTS),
});
