import { z } from 'zod';
import { safeText } from './common';

/**
 * Bodies for managing the user's accounts (launch item i41): create one,
 * or change its name, description or cash. Names follow the CSV import's
 * "new account" rule.
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

/** POST /api/portfolios */
export const portfolioCreateSchema = z.object({
    name,
    description: description.optional(),
    cashBalance: cashBalance.optional(),
}).strict();

/** PATCH /api/portfolios/[id]: any of the fields, at least one. */
export const portfolioUpdateSchema = z.object({
    name: name.optional(),
    // An empty description clears it.
    description: description.optional(),
    cashBalance: cashBalance.optional(),
}).strict().refine(
    (body) => body.name !== undefined || body.description !== undefined || body.cashBalance !== undefined,
    'Change at least one of name, description or cash',
);

export type PortfolioCreateBody = z.infer<typeof portfolioCreateSchema>;
export type PortfolioUpdateBody = z.infer<typeof portfolioUpdateSchema>;
