/**
 * PUT    /api/portfolio/manual-holdings/[id] — saves one of the signed-in
 *        user's holdings valued by hand as the form now has it, possibly in
 *        another of their accounts.
 * DELETE /api/portfolio/manual-holdings/[id] — deletes it.
 *
 * Any other ID is a 404, as if it didn't exist.
 *
 * PUT body:  { portfolioId, holding } as for POST /api/portfolio/manual-holdings.
 * Responses: PUT 200 { data: { id } }, DELETE 204; 400 INVALID_MANUAL_HOLDING; 404 MANUAL_HOLDING_NOT_FOUND
 *            or PORTFOLIO_NOT_FOUND
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { deleteManualHolding, updateManualHolding } from '@/lib/portfolio/manual-holdings';
import { AccountNotFoundError } from '@/lib/portfolio/transactionsWrite';
import { manualHoldingBodySchema, MAX_MANUAL_HOLDING_BODY_BYTES } from '@/lib/validators/manual-holding';

export const dynamic = 'force-dynamic';

const idSchema = z.guid();

type Params = { params: Promise<{ id: string }> };

const notFound = () => apiError('Holding not found', 'MANUAL_HOLDING_NOT_FOUND', 404);

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    const body = await readJsonBody(request, MAX_MANUAL_HOLDING_BODY_BYTES);
    if (!body.ok) return apiError('Invalid holding', 'INVALID_MANUAL_HOLDING', body.reason === 'too-large' ? 413 : 400);
    const parsed = manualHoldingBodySchema.safeParse(body.value);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid holding', 'INVALID_MANUAL_HOLDING', 400);

    try {
        const saved = await updateManualHolding(auth.context.userId, id, parsed.data.portfolioId, parsed.data.holding);
        return saved ? NextResponse.json({ data: { id } }) : notFound();
    } catch (err) {
        if (err instanceof AccountNotFoundError) return apiError('Account not found', 'PORTFOLIO_NOT_FOUND', 404);
        return internalServerError(err, 'Unable to save the holding.', 'MANUAL_HOLDING_UPDATE_FAILED');
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    try {
        return (await deleteManualHolding(auth.context.userId, id)) ? new NextResponse(null, { status: 204 }) : notFound();
    } catch (err) {
        return internalServerError(err, 'Unable to delete the holding.', 'MANUAL_HOLDING_DELETE_FAILED');
    }
}
