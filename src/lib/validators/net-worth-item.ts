import { z } from 'zod';

import { kindOfCategory, NET_WORTH_CATEGORIES, NET_WORTH_KINDS } from '@/lib/portfolio/net-worth';

import { safeText } from './common';

/**
 * An asset or debt outside the accounts (net_worth_items): what it is, what
 * it's called, its value as of a day and an optional note. For a debt the
 * value is the balance owed, a positive amount. The category must be one of
 * the kind's. A date after today is allowed, as for holdings valued by hand.
 *
 * The body of POST /api/portfolio/net-worth-items and PUT
 * /api/portfolio/net-worth-items/[id] is the item itself.
 */

export const NET_WORTH_ITEM_LIMITS = { name: 120, note: 500, value: 1e12 } as const;
export const MAX_NET_WORTH_ITEM_BODY_BYTES = 4 * 1024;

export const netWorthItemSchema = z.object({
    kind: z.enum(NET_WORTH_KINDS, { message: 'Choose asset or debt' }),
    category: z.enum(NET_WORTH_CATEGORIES, { message: 'Choose what it is' }),
    name: safeText.trim().min(1, 'Name the asset or debt').max(NET_WORTH_ITEM_LIMITS.name, 'Name is too long'),
    value: z.number({ message: 'Value must be a number' })
        .finite('Value must be a number')
        .min(0, "Value can't be negative")
        .max(NET_WORTH_ITEM_LIMITS.value, 'Value is out of range')
        .transform((n) => Math.round(n * 100) / 100),
    valueAsOf: z.iso.date({ message: 'Enter the date of the value (YYYY-MM-DD)' }),
    note: safeText.trim().max(NET_WORTH_ITEM_LIMITS.note, 'Note is too long').nullable().optional()
        .transform((v) => v || null),
}).strict().superRefine((item, ctx) => {
    if (kindOfCategory(item.category) !== item.kind) {
        ctx.addIssue({
            code: 'custom',
            path: ['category'],
            message: item.kind === 'asset' ? 'Choose a kind of asset' : 'Choose a kind of debt',
        });
    }
});

export type NetWorthItemInput = z.infer<typeof netWorthItemSchema>;
