import { NextResponse } from 'next/server';
import { schwabClient } from '@/lib/api/schwab/client';
import { orderSchema } from '@/lib/validators/execution';

export async function POST(request: Request) {
    try {
        // Security check: simple token-based authentication for the internal API
        const apiKey = request.headers.get('X-API-Key');
        const internalSecret = process.env.INTERNAL_API_SECRET;

        if (!internalSecret || apiKey !== internalSecret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();

        const result = orderSchema.safeParse(body.order);
        if (!result.success) {
            return NextResponse.json({ error: 'Invalid order data', details: result.error.format() }, { status: 400 });
        }

        const order = result.data;

        const accessToken = process.env.SCHWAB_ACCESS_TOKEN;
        const accountId = process.env.SCHWAB_ACCOUNT_ID;

        if (!accessToken || !accountId) {
            return NextResponse.json({ error: 'Schwab credentials not configured' }, { status: 401 });
        }

        // We map our simplified app Order to Schwab's Order format
        const schwabOrderPayload: any = {
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
        console.error('Error placing order:', error);
        return NextResponse.json({ error: 'Failed to place order' }, { status: 500 });
    }
}
