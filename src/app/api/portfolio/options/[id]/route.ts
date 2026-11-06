/**
 * PUT    /api/portfolio/options/[id] — saves one of the signed-in user's
 *        option positions as the Holdings form now has it, possibly in
 *        another of their accounts (launch item i63).
 * DELETE /api/portfolio/options/[id] — deletes it.
 *
 * Any other ID is a 404, as if it didn't exist.
 *
 * PUT body: { portfolioId, position } as for POST /api/portfolio/options.
 * Responses: PUT 200 { data: { id } }, DELETE 204; 400 INVALID_OPTION_POSITION; 404 OPTION_POSITION_NOT_FOUND
 *            or PORTFOLIO_NOT_FOUND; 409 OPTION_POSITION_EXISTS
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { deleteOptionPosition, DuplicateOptionPositionError, updateOptionPosition } from '@/lib/portfolio/option-positions-store';
import { AccountNotFoundError } from '@/lib/portfolio/transactionsWrite';
import { MAX_OPTION_POSITION_BODY_BYTES, optionPositionUpdateSchema } from '@/lib/validators/option-position';

export const dynamic = 'force-dynamic';

const idSchema = z.guid();

type Params = { params: Promise<{ id: string }> };

const notFound = () => apiError('Option position not found', 'OPTION_POSITION_NOT_FOUND', 404);

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    const body = await readJsonBody(request, MAX_OPTION_POSITION_BODY_BYTES);
    if (!body.ok) return apiError('Invalid option position', 'INVALID_OPTION_POSITION', body.reason === 'too-large' ? 413 : 400);
    const parsed = optionPositionUpdateSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid option position', 'INVALID_OPTION_POSITION', 400);
    }

    try {
        const saved = await updateOptionPosition(auth.context.userId, id, parsed.data.portfolioId, parsed.data.position);
        return saved ? NextResponse.json({ data: { id } }) : notFound();
    } catch (err) {
        if (err instanceof AccountNotFoundError) return apiError('Account not found', 'PORTFOLIO_NOT_FOUND', 404);
        if (err instanceof DuplicateOptionPositionError) {
            return apiError('That account already holds this contract.', 'OPTION_POSITION_EXISTS', 409);
        }
        return internalServerError(err, 'Unable to save the option position.', 'OPTION_POSITION_UPDATE_FAILED');
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    try {
        return (await deleteOptionPosition(auth.context.userId, id)) ? new NextResponse(null, { status: 204 }) : notFound();
    } catch (err) {
        return internalServerError(err, 'Unable to delete the option position.', 'OPTION_POSITION_DELETE_FAILED');
    }
}
