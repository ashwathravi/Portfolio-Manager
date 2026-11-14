/**
 * PUT    /api/strategies/[id]  replaces one of the user's strategies (its last backtest stays)
 * DELETE /api/strategies/[id]  deletes it
 *
 * Launch item i55. Any other ID is a 404, as if it didn't exist.
 *
 * PUT body:  as POST /api/strategies
 * Responses: 200 { data: Strategy } / 204; 400 INVALID_STRATEGY; 404 STRATEGY_NOT_FOUND
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { deleteStrategy, updateStrategy } from '@/lib/strategies/store';

import { parseStrategyBody } from '@/lib/api/strategy-request';

export const dynamic = 'force-dynamic';

const idSchema = z.guid();

type Params = { params: Promise<{ id: string }> };

const notFound = () => apiError('Strategy not found', 'STRATEGY_NOT_FOUND', 404);

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    const parsed = await parseStrategyBody(request);
    if (!parsed.ok) return parsed.response;

    try {
        const strategy = await updateStrategy(auth.context.userId, id, parsed.input);
        return strategy ? NextResponse.json({ data: strategy }) : notFound();
    } catch (err) {
        return internalServerError(err, 'Unable to save the strategy.', 'STRATEGY_UPDATE_FAILED');
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    try {
        return (await deleteStrategy(auth.context.userId, id)) ? new NextResponse(null, { status: 204 }) : notFound();
    } catch (err) {
        return internalServerError(err, 'Unable to delete the strategy.', 'STRATEGY_DELETE_FAILED');
    }
}
