import { z } from 'zod';
import { ACCOUNT_TYPES, INSTITUTION_MAX_LENGTH, OWNERSHIPS, TAX_TREATMENTS } from '@/lib/portfolio/account-kinds';
import { safeText } from './common';

/**
 * Bodies for managing the user's accounts (launch item i41): create one,
 * or change its name, description, cash, type, institution, tax treatment
 * or ownership. Names follow the CSV import's "new account" rule.
 */

export const PORTFOLIO_LIMITS = { name: 80, description: 500, cash: 1e12 } as const;

const name = safeText.trim().min(1, 'Name the account').max(PORTFOLIO_LIMITS.name, 'Account name is too long');
const description = safeText.trim().max(PORTFOLIO_LIMITS.description, 'Description is too long');
// Negative for a margin balance; whole cents.
const cashBalance = z.number({ message: 'Cash must be a number' })
    .finite('Cash must be a number')
    .min(-PORTFOLIO_LIMITS.cash, 'Cash is out of range')
    .max(PORTFOLIO_LIMITS.cash, 'Cash is out of range')
    .transform((value) => Math.round(value * 100) / 100);

// Each can be cleared with null; an empty institution clears it too.
const accountType = z.enum(ACCOUNT_TYPES, { message: 'Choose an account type' }).nullable();
const taxTreatment = z.enum(TAX_TREATMENTS, { message: 'Choose how the account is taxed' }).nullable();
const ownership = z.enum(OWNERSHIPS, { message: 'Choose whose account it is' }).nullable();
const institution = safeText.trim().max(INSTITUTION_MAX_LENGTH, 'Institution name is too long').nullable();

/** POST /api/portfolios */
export const portfolioCreateSchema = z.object({
    name,
    description: description.optional(),
    cashBalance: cashBalance.optional(),
    accountType: accountType.optional(),
    institution: institution.optional(),
    taxTreatment: taxTreatment.optional(),
    ownership: ownership.optional(),
}).strict();

/** PATCH /api/portfolios/[id]: any of the fields, at least one. */
export const portfolioUpdateSchema = z.object({
    name: name.optional(),
    // An empty description clears it.
    description: description.optional(),
    cashBalance: cashBalance.optional(),
    accountType: accountType.optional(),
    institution: institution.optional(),
    taxTreatment: taxTreatment.optional(),
    ownership: ownership.optional(),
}).strict().refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Change at least one of name, description, cash, type, institution, tax treatment or ownership',
);

export type PortfolioCreateBody = z.infer<typeof portfolioCreateSchema>;
export type PortfolioUpdateBody = z.infer<typeof portfolioUpdateSchema>;
