/**
 * PATCH  /api/portfolios/[id]  renames an account or changes its description or cash
 * DELETE /api/portfolios/[id]  deletes it, with its holdings, transactions and history
 *
 * Launch item i41. Only the signed-in user's own accounts: any other ID is
 * a 404, as if it didn't exist.
 *
 * PATCH body: { name?, description?, cashBalance? } (at least one)
 * Responses:  PATCH 200 { data: { id, name, description, cashBalance } }; DELETE 204;
 *             400 INVALID_PORTFOLIO; 404 PORTFOLIO_NOT_FOUND;
 *             409 DUPLICATE_ACCOUNT_NAME (a rename to another account's name, ignoring case)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { deletePortfolio, DuplicateAccountNameError, updatePortfolio } from '@/lib/portfolio/manage';
import { portfolioUpdateSchema } from '@/lib/validators/portfolio';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;
// Any 8-4-4-4-12 hex value Postgres takes as a uuid; the query decides
// whether it is one of the user's.
const idSchema = z.guid();

type Params = { params: Promise<{ id: string }> };

function notFound() {
    return apiError('Account not found', 'PORTFOLIO_NOT_FOUND', 404);
}

export async function PATCH(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return apiError('Invalid account', 'INVALID_PORTFOLIO', body.reason === 'too-large' ? 413 : 400);
    const parsed = portfolioUpdateSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid account', 'INVALID_PORTFOLIO', 400);
    }

    try {
        const data = await updatePortfolio(auth.context.userId, id, parsed.data);
        return data ? NextResponse.json({ data }) : notFound();
    } catch (err) {
        if (err instanceof DuplicateAccountNameError) {
            return apiError(`You already have an account named ${err.accountName}.`, 'DUPLICATE_ACCOUNT_NAME', 409);
        }
        return internalServerError(err, 'Unable to change the account.', 'PORTFOLIO_UPDATE_FAILED');
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    try {
        return (await deletePortfolio(auth.context.userId, id)) ? new NextResponse(null, { status: 204 }) : notFound();
    } catch (err) {
        return internalServerError(err, 'Unable to delete the account.', 'PORTFOLIO_DELETE_FAILED');
    }
}
