/**
 * POST /api/portfolio/manual-holdings
 *
 * Adds a holding valued by hand (one Atlas can't price: a fund with no
 * ticker, a private holding) to one of the signed-in user's accounts.
 *
 * Body:     { portfolioId, holding: { name, identifier?, quantity?, value, costBasis?, valueAsOf } }
 * Response: 201 { data: { id } }; 400 INVALID_MANUAL_HOLDING; 404 PORTFOLIO_NOT_FOUND; 413 when the body is too large
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { addManualHolding } from '@/lib/portfolio/manual-holdings';
import { AccountNotFoundError } from '@/lib/portfolio/transactionsWrite';
import { manualHoldingBodySchema, MAX_MANUAL_HOLDING_BODY_BYTES } from '@/lib/validators/manual-holding';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_MANUAL_HOLDING_BODY_BYTES);
    if (!body.ok) return apiError('Invalid holding', 'INVALID_MANUAL_HOLDING', body.reason === 'too-large' ? 413 : 400);
    const parsed = manualHoldingBodySchema.safeParse(body.value);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid holding', 'INVALID_MANUAL_HOLDING', 400);

    try {
        const id = await addManualHolding(auth.context.userId, parsed.data.portfolioId, parsed.data.holding);
        return NextResponse.json({ data: { id } }, { status: 201 });
    } catch (err) {
        if (err instanceof AccountNotFoundError) return apiError('Account not found', 'PORTFOLIO_NOT_FOUND', 404);
        return internalServerError(err, 'Unable to add the holding.', 'MANUAL_HOLDING_CREATE_FAILED');
    }
}
