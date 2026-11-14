/**
 * POST /api/portfolio/options
 *
 * Adds an option position, entered by hand on Holdings, to one of the
 * signed-in user's accounts (launch item i63), for the LEAPS ledger and the
 * risk policy's options checks.
 *
 * Body:     { portfolioId, position: { underlying, contractType, strike, expiry, quantity, premium, multiplier?,
 *             openedAt?, userMark?, userMarkDate?, thesisId?, expiryTest?, exitRule? } }
 * Response: 201 { data: { id } }; 400 INVALID_OPTION_POSITION; 404 PORTFOLIO_NOT_FOUND;
 *           409 OPTION_POSITION_EXISTS (the account already holds the contract); 413 when the body is too large
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { addOptionPosition, DuplicateOptionPositionError } from '@/lib/portfolio/option-positions-store';
import { AccountNotFoundError } from '@/lib/portfolio/transactionsWrite';
import { MAX_OPTION_POSITION_BODY_BYTES, optionPositionCreateSchema } from '@/lib/validators/option-position';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_OPTION_POSITION_BODY_BYTES);
    if (!body.ok) return apiError('Invalid option position', 'INVALID_OPTION_POSITION', body.reason === 'too-large' ? 413 : 400);
    const parsed = optionPositionCreateSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid option position', 'INVALID_OPTION_POSITION', 400);
    }

    try {
        const id = await addOptionPosition(auth.context.userId, parsed.data.portfolioId, parsed.data.position);
        return NextResponse.json({ data: { id } }, { status: 201 });
    } catch (err) {
        if (err instanceof AccountNotFoundError) return apiError('Account not found', 'PORTFOLIO_NOT_FOUND', 404);
        if (err instanceof DuplicateOptionPositionError) {
            return apiError('That account already holds this contract. Edit it instead.', 'OPTION_POSITION_EXISTS', 409);
        }
        return internalServerError(err, 'Unable to add the option position.', 'OPTION_POSITION_CREATE_FAILED');
    }
}
