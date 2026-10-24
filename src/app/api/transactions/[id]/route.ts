/**
 * DELETE /api/transactions/[id]
 *
 * Deletes one of the signed-in user's transactions (launch item i40). Any
 * other ID is a 404, as if it didn't exist.
 *
 * Responses: 204; 404 TRANSACTION_NOT_FOUND
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { deleteTransaction } from '@/lib/portfolio/transactionsWrite';

export const dynamic = 'force-dynamic';

const idSchema = z.guid();

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const notFound = () => apiError('Transaction not found', 'TRANSACTION_NOT_FOUND', 404);
    if (!idSchema.safeParse(id).success) return notFound();

    try {
        return (await deleteTransaction(auth.context.userId, id)) ? new NextResponse(null, { status: 204 }) : notFound();
    } catch (err) {
        return internalServerError(err, 'Unable to delete the transaction.', 'TRANSACTION_DELETE_FAILED');
    }
}
