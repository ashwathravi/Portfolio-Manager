/**
 * POST /api/transactions
 *
 * Adds a transaction, entered by hand, to one of the signed-in user's
 * accounts (launch item i40). A record of activity: holdings and cash
 * aren't changed.
 *
 * Body:     { portfolioId, transaction: { type, date, symbol?, quantity?, price?, amount?, fees?, currency?, notes? } }
 * Response: 201 { data: { id } }; 400 INVALID_TRANSACTION; 404 PORTFOLIO_NOT_FOUND
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { AccountNotFoundError, addTransaction } from '@/lib/portfolio/transactionsWrite';
import { transactionCreateSchema } from '@/lib/validators/transaction';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return apiError('Invalid transaction', 'INVALID_TRANSACTION', body.reason === 'too-large' ? 413 : 400);
    const parsed = transactionCreateSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid transaction', 'INVALID_TRANSACTION', 400);
    }

    try {
        const id = await addTransaction(auth.context.userId, parsed.data.portfolioId, parsed.data.transaction);
        return NextResponse.json({ data: { id } }, { status: 201 });
    } catch (err) {
        if (err instanceof AccountNotFoundError) return apiError('Account not found', 'PORTFOLIO_NOT_FOUND', 404);
        return internalServerError(err, 'Unable to add the transaction.', 'TRANSACTION_CREATE_FAILED');
    }
}
