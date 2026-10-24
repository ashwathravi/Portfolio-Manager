/**
 * POST /api/portfolios
 *
 * Creates an account for the signed-in user (launch item i41): a name, and
 * optionally a description and a starting cash balance.
 *
 * Body:     { name, description?, cashBalance? }
 * Response: 201 { data: { id, name, description, cashBalance } }; 400 INVALID_PORTFOLIO;
 *           409 DUPLICATE_ACCOUNT_NAME (another account has the name, ignoring case)
 *           or ACCOUNT_LIMIT (the user has MAX_ACCOUNTS_PER_USER already)
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { AccountLimitError, createPortfolio, DuplicateAccountNameError, MAX_ACCOUNTS_PER_USER } from '@/lib/portfolio/manage';
import { portfolioCreateSchema } from '@/lib/validators/portfolio';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return apiError('Invalid account', 'INVALID_PORTFOLIO', body.reason === 'too-large' ? 413 : 400);
    const parsed = portfolioCreateSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid account', 'INVALID_PORTFOLIO', 400);
    }

    try {
        const data = await createPortfolio(auth.context.userId, parsed.data);
        return NextResponse.json({ data }, { status: 201 });
    } catch (err) {
        if (err instanceof DuplicateAccountNameError) {
            return apiError(`You already have an account named ${err.accountName}.`, 'DUPLICATE_ACCOUNT_NAME', 409);
        }
        if (err instanceof AccountLimitError) {
            return apiError(`You can have at most ${MAX_ACCOUNTS_PER_USER} accounts.`, 'ACCOUNT_LIMIT', 409);
        }
        return internalServerError(err, 'Unable to create the account.', 'PORTFOLIO_CREATE_FAILED');
    }
}
