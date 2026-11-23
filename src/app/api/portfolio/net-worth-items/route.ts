/**
 * POST /api/portfolio/net-worth-items
 *
 * Adds an asset or debt the signed-in user has outside their accounts (a
 * home, a car, a mortgage, a card balance), for the net worth on Today. Its
 * value as of its day is kept too (net_worth_item_values).
 *
 * Body:     { kind, category, name, value, valueAsOf, note? } (src/lib/validators/net-worth-item.ts); for a
 *           debt, value is the balance owed
 * Response: 201 { data: { id } }; 400 INVALID_NET_WORTH_ITEM; 409 NET_WORTH_ITEM_LIMIT (launch item i77);
 *           413 when the body is too large; 503 NET_WORTH_NOT_STORED without a database
 */

import { NextResponse } from 'next/server';

import { isDatabaseConfigured } from '@/db/connection-options';
import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { RecordLimitError } from '@/lib/limits/records';
import { recordLimitResponse } from '@/lib/limits/records-server';
import { addNetWorthItem } from '@/lib/portfolio/net-worth-items';
import { MAX_NET_WORTH_ITEM_BODY_BYTES, netWorthItemSchema } from '@/lib/validators/net-worth-item';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) {
        return apiError('Assets and debts are kept with your account, and this server has no database.', 'NET_WORTH_NOT_STORED', 503);
    }

    const body = await readJsonBody(request, MAX_NET_WORTH_ITEM_BODY_BYTES);
    if (!body.ok) return apiError('Invalid asset or debt', 'INVALID_NET_WORTH_ITEM', body.reason === 'too-large' ? 413 : 400);
    const parsed = netWorthItemSchema.safeParse(body.value);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? 'Invalid asset or debt', 'INVALID_NET_WORTH_ITEM', 400);

    try {
        const id = await addNetWorthItem(auth.context.userId, parsed.data);
        return NextResponse.json({ data: { id } }, { status: 201 });
    } catch (err) {
        if (err instanceof RecordLimitError) return recordLimitResponse(err);
        return internalServerError(err, 'Unable to add the asset or debt.', 'NET_WORTH_ITEM_CREATE_FAILED');
    }
}
