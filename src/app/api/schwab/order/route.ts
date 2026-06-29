import { NextResponse } from 'next/server';
import { apiError, authenticateApiRequest, internalServerError } from '@/lib/api/security';
import { schwabClient } from '@/lib/api/schwab/client';
import { orderSchema } from '@/lib/validators/execution';

interface SchwabOrderPayload {
    orderType: 'MARKET' | 'LIMIT';
    session: 'NORMAL';
    duration: 'DAY' | 'GOOD_TILL_CANCEL';
    orderStrategyType: 'SINGLE';
    orderLegCollection: Array<{
        instruction: 'BUY' | 'SELL';
        quantity: number;
        instrument: {
            symbol: string;
            assetType: 'EQUITY';
        };
    }>;
    price?: number;
}

export async function POST(request: Request) {
    if (!process.env.INTERNAL_API_SECRET?.trim()) {
        return apiError('API authentication is not configured.', 'API_AUTH_NOT_CONFIGURED', 503);
    }

    const auth = authenticateApiRequest(request);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json();

        const result = orderSchema.safeParse(body.order);
        if (!result.success) {
            return NextResponse.json(
                { error: 'Invalid order data', code: 'INVALID_ORDER', details: result.error.format() },
                { status: 400 },
            );
        }

        const order = result.data;

        const accessToken = process.env.SCHWAB_ACCESS_TOKEN;
        const accountId = process.env.SCHWAB_ACCOUNT_ID;

        if (!accessToken || !accountId) {
            return apiError('Schwab credentials not configured', 'SCHWAB_CREDENTIALS_MISSING', 401);
        }

        // We map our simplified app Order to Schwab's Order format
        const schwabOrderPayload: SchwabOrderPayload = {
            orderType: order.type === 'market' ? 'MARKET' : 'LIMIT',
            session: 'NORMAL',
            duration: order.type === 'market' ? 'DAY' : (order.timeInForce === 'gtc' ? 'GOOD_TILL_CANCEL' : 'DAY'),
            orderStrategyType: 'SINGLE',
            orderLegCollection: [
                {
                    instruction: order.side === 'buy' ? 'BUY' : 'SELL',
                    quantity: order.quantity,
                    instrument: {
                        symbol: order.ticker,
                        assetType: 'EQUITY'
                    }
                }
            ]
        };

        if (order.type !== 'market' && order.limitPrice) {
            schwabOrderPayload.price = order.limitPrice;
        }

        await schwabClient.placeOrder(accessToken, accountId, schwabOrderPayload);

        return NextResponse.json({ success: true, message: 'Order submitted to broker' });
    } catch (error) {
        return internalServerError(error, 'Failed to place order', 'SCHWAB_ORDER_FAILED');
    }
}
