import { z } from 'zod';

import { safeText } from './common';

/**
 * A holding valued by hand (manual_holdings): what it is, its value as of
 * a day, and optionally how many units and what it cost. The value is the
 * whole holding's, not a price per unit.
 */

export const MANUAL_HOLDING_LIMITS = { name: 120, identifier: 40, value: 1e12 } as const;
export const MAX_MANUAL_HOLDING_BODY_BYTES = 4 * 1024;

const money = (label: string) => z.number({ message: `${label} must be a number` })
    .finite(`${label} must be a number`)
    .min(0, `${label} can't be negative`)
    .max(MANUAL_HOLDING_LIMITS.value, `${label} is out of range`)
    .transform((n) => Math.round(n * 100) / 100);

export const manualHoldingSchema = z.object({
    name: safeText.trim().min(1, 'Name the holding').max(MANUAL_HOLDING_LIMITS.name, 'Name is too long'),
    identifier: safeText.trim().max(MANUAL_HOLDING_LIMITS.identifier, 'Identifier is too long').nullable().optional()
        .transform((v) => v || null),
    quantity: z.number({ message: 'Units must be a number' }).finite('Units must be a number').positive('Units must be more than 0')
        .max(1e12, 'Units are out of range').nullable().optional().transform((v) => v ?? null),
    value: money('Value'),
    costBasis: money('Cost').nullable().optional().transform((v) => v ?? null),
    valueAsOf: z.iso.date({ message: 'Enter the date of the value (YYYY-MM-DD)' }),
}).strict();

export type ManualHoldingInput = z.infer<typeof manualHoldingSchema>;

/** POST /api/portfolio/manual-holdings and PUT /api/portfolio/manual-holdings/[id]. */
export const manualHoldingBodySchema = z.object({
    portfolioId: z.guid('Choose an account'),
    holding: manualHoldingSchema,
}).strict();
