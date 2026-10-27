/**
 * PATCH /api/orders/[id]
 *
 * Moves one of the signed-in user's order plans along (launch item i53):
 * approve one waiting for approval (`ready`), mark a ready one `placed`
 * once it's placed at the broker, or cancel one that isn't cancelled yet.
 * Any other ID is a 404, as if it didn't exist.
 *
 * Body:      { status: "ready" | "placed" | "cancelled" }
 * Responses: 200 { data: Order }; 400 INVALID_ORDER_STATUS; 404 ORDER_NOT_FOUND;
 *            409 ORDER_STATUS_CONFLICT { data: Order } (it was placed or cancelled meanwhile)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { changeOrderPlanStatus, OrderStatusConflictError } from '@/lib/execution/orders';
import { ORDER_STATUS_LABELS } from '@/lib/execution/order-status';
import { orderPlanStatusSchema } from '@/lib/validators/order-plan';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024;
const idSchema = z.guid();

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const notFound = () => apiError('Order not found', 'ORDER_NOT_FOUND', 404);
    if (!idSchema.safeParse(id).success) return notFound();

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return apiError('Invalid status', 'INVALID_ORDER_STATUS', body.reason === 'too-large' ? 413 : 400);
    const parsed = orderPlanStatusSchema.safeParse(body.value);
    if (!parsed.success) {
        return apiError(parsed.error.issues[0]?.message ?? 'Invalid status', 'INVALID_ORDER_STATUS', 400);
    }

    try {
        const order = await changeOrderPlanStatus(auth.context.userId, id, parsed.data.status);
        return order ? NextResponse.json({ data: order }) : notFound();
    } catch (err) {
        if (err instanceof OrderStatusConflictError) {
            return NextResponse.json({
                error: `This order is already ${ORDER_STATUS_LABELS[err.order.status].toLowerCase()}.`,
                code: 'ORDER_STATUS_CONFLICT',
                data: err.order,
            }, { status: 409 });
        }
        return internalServerError(err, 'Unable to update the order.', 'ORDER_UPDATE_FAILED');
    }
}
