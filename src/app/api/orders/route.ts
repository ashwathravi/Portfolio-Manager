/**
 * POST /api/orders
 *
 * Saves an order plan the user drafted on Trade, for one of their
 * accounts (launch item i53). Atlas never routes it: it waits for the
 * user's approval when it's over their threshold, else it's ready for them
 * to place at their broker.
 *
 * Body:     { portfolioId, instrumentType, ticker, side, type, quantity, limitPrice?, stopPrice?, timeInForce,
 *             referencePrice?, referencePriceDate?, needsApproval, rationale?, optionDetails?, policy? }
 * Response: 201 { data: Order }; 400 INVALID_ORDER; 404 PORTFOLIO_NOT_FOUND; 409 ORDER_LIMIT
 */

import { NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/api/body';
import { apiError, internalServerError } from '@/lib/api/security';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { createOrderPlan, OrderPlanLimitError } from '@/lib/execution/orders';
import { AccountNotFoundError } from '@/lib/portfolio/transactionsWrite';
import { ORDER_PLAN_LIMITS, orderPlanCreateSchema } from '@/lib/validators/order-plan';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;

export async function POST(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return apiError('Invalid order', 'INVALID_ORDER', body.reason === 'too-large' ? 413 : 400);
    const parsed = orderPlanCreateSchema.safeParse(body.value);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.length ? `${issue.path.join('.')}: ` : '';
        return apiError(`${field}${issue?.message ?? 'Invalid order'}`, 'INVALID_ORDER', 400);
    }

    try {
        const order = await createOrderPlan(auth.context.userId, parsed.data);
        return NextResponse.json({ data: order }, { status: 201 });
    } catch (err) {
        if (err instanceof AccountNotFoundError) return apiError('Account not found', 'PORTFOLIO_NOT_FOUND', 404);
        if (err instanceof OrderPlanLimitError) {
            return apiError(`You can keep at most ${ORDER_PLAN_LIMITS.perUser.toLocaleString('en-US')} order plans.`, 'ORDER_LIMIT', 409);
        }
        return internalServerError(err, 'Unable to save the order.', 'ORDER_CREATE_FAILED');
    }
}
