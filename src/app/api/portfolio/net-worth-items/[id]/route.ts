/**
 * PUT    /api/portfolio/net-worth-items/[id] — saves one of the signed-in
 *        user's other assets or debts as the form now has it (its category
 *        may change), keeping the value as of its day. Its kind may not: an
 *        asset stays an asset and a debt a debt, since the values kept by
 *        day are of the kind it had (400, nothing saved).
 * DELETE /api/portfolio/net-worth-items/[id] — deletes it, with its values.
 *
 * Any other ID is a 404, as if it didn't exist. An edit or a deletion is
 * never refused by the limit on how many the user keeps.
 *
 * PUT body:  the item, as for POST /api/portfolio/net-worth-items.
 * Responses: PUT 200 { data: { id } }, DELETE 204; 400 INVALID_NET_WORTH_ITEM (a kind change included);
 *            404 NET_WORTH_ITEM_NOT_FOUND; 413 when the body is too large; 503 NET_WORTH_NOT_STORED without a database
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isDatabaseConfigured } from '@/db/connection-options';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { deleteNetWorthItem, NetWorthKindChangeError, updateNetWorthItem } from '@/lib/portfolio/net-worth-items';
import { MAX_NET_WORTH_ITEM_BODY_BYTES, netWorthItemSchema } from '@/lib/validators/net-worth-item';

export const dynamic = 'force-dynamic';

const idSchema = z.guid();

type Params = { params: Promise<{ id: string }> };

const notFound = () => apiError('Asset or debt not found', 'NET_WORTH_ITEM_NOT_FOUND', 404);
const notStored = () => apiError('Assets and debts are kept with your account, and this server has no database.', 'NET_WORTH_NOT_STORED', 503);

export async function PUT(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) return notStored();
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    const body = await readJsonBody(request, MAX_NET_WORTH_ITEM_BODY_BYTES);
    if (!body.ok) return apiError('Invalid asset or debt', 'INVALID_NET_WORTH_ITEM', body.reason === 'too-large' ? 413 : 400);
    const parsed = netWorthItemSchema.safeParse(body.value);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid asset or debt', 'INVALID_NET_WORTH_ITEM', 400);

    try {
        return (await updateNetWorthItem(auth.context.userId, id, parsed.data)) ? NextResponse.json({ data: { id } }) : notFound();
    } catch (err) {
        if (err instanceof NetWorthKindChangeError) return apiError(err.message, 'INVALID_NET_WORTH_ITEM', 400);
        return internalServerError(err, 'Unable to save the asset or debt.', 'NET_WORTH_ITEM_UPDATE_FAILED');
    }
}

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) return notStored();
    const { id } = await params;
    if (!idSchema.safeParse(id).success) return notFound();

    try {
        return (await deleteNetWorthItem(auth.context.userId, id)) ? new NextResponse(null, { status: 204 }) : notFound();
    } catch (err) {
        return internalServerError(err, 'Unable to delete the asset or debt.', 'NET_WORTH_ITEM_DELETE_FAILED');
    }
}
