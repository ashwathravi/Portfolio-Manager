import { z } from 'zod';

import { isCalendarDate, isOptionStrike, OPTION_POSITION_MULTIPLIER } from '@/lib/portfolio/option-positions';
import { OPTION_CONTRACT_TYPES } from '@/lib/risk-policy/options';
import { safeText } from './common';
import { tickerSchema } from './market-data';

/**
 * Option positions as the browser sends them (launch item i63): one entered
 * by hand on Holdings, or the option rows of a positions CSV.
 */

export const OPTION_POSITION_LIMITS = { expiryTest: 500, exitRule: 500, thesisId: 128, importRows: 500 } as const;

/** What the option position routes read of a request body. */
export const MAX_OPTION_POSITION_BODY_BYTES = 8 * 1024;

const date = (name: string) => z.string({ message: `${name} must be a date (YYYY-MM-DD)` })
    .refine(isCalendarDate, `${name} must be a date (YYYY-MM-DD)`);

const price = (name: string) => z.number({ message: `${name} must be a number` })
    .finite(`${name} must be a number`)
    .min(0, `${name} can't be negative`)
    .max(1e6, `${name} is out of range`);

/** The contract and how many: what a CSV row has. */
export const optionContractRowSchema = z.object({
    underlying: tickerSchema,
    contractType: z.enum(OPTION_CONTRACT_TYPES, { message: 'contractType must be call or put' }),
    strike: z.number({ message: 'strike must be a number' }).refine(isOptionStrike, 'Enter a strike above 0, to at most three decimals'),
    expiry: date('expiry'),
    // Negative for a written (short) position.
    quantity: z.number({ message: 'quantity must be a number' }).finite()
        .refine((q) => q !== 0, 'Enter the number of contracts')
        .refine((q) => Math.abs(q) <= 1e6, 'quantity is out of range'),
    premium: price('premium'),
}).strict();

export type OptionContractRow = z.infer<typeof optionContractRowSchema>;

/** A position as the Holdings form saves it. */
export const optionPositionSchema = optionContractRowSchema.extend({
    multiplier: z.number().int('multiplier must be a whole number').positive('multiplier must be more than 0').max(10_000)
        .default(OPTION_POSITION_MULTIPLIER),
    openedAt: date('openedAt').nullable().default(null),
    userMark: price('userMark').nullable().default(null),
    userMarkDate: date('userMarkDate').nullable().default(null),
    thesisId: z.string().trim().min(1).max(OPTION_POSITION_LIMITS.thesisId).regex(/^[^\p{Cc}]*$/u, 'thesisId must be printable text')
        .nullable().default(null),
    expiryTest: safeText.trim().max(OPTION_POSITION_LIMITS.expiryTest, 'What must be true is at most 500 characters').default(''),
    exitRule: safeText.trim().max(OPTION_POSITION_LIMITS.exitRule, 'The exit rule is at most 500 characters').default(''),
}).strict()
    .refine((p) => (p.userMark == null) === (p.userMarkDate == null), { message: 'A price of your own needs its date', path: ['userMarkDate'] });

export type OptionPositionInput = z.infer<typeof optionPositionSchema>;

/** POST /api/portfolio/options: one position, into one of the user's accounts. */
export const optionPositionCreateSchema = z.object({
    portfolioId: z.guid('Choose an account'),
    position: optionPositionSchema,
}).strict();

/** PUT /api/portfolio/options/[id]: the position as it now is, possibly in another of the user's accounts. */
export const optionPositionUpdateSchema = optionPositionCreateSchema;

/** The option rows of a positions CSV (POST /api/portfolio/import). Each contract at most once. */
export const optionImportRowsSchema = z.array(optionContractRowSchema)
    .max(OPTION_POSITION_LIMITS.importRows, `Import at most ${OPTION_POSITION_LIMITS.importRows} option positions at once`)
    .refine((rows) => {
        const keys = rows.map((r) => `${r.underlying}|${r.contractType}|${r.strike}|${r.expiry}`);
        return new Set(keys).size === keys.length;
    }, 'Each option contract can appear only once');
