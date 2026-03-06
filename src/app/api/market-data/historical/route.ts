import { NextResponse } from 'next/server';
import { marketDataEngine } from '@/lib/api/market-data';
import { tickerSchema, timeframeSchema } from '@/lib/validators/market-data';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const symbolParam = searchParams.get('symbol');
    const timeframeParam = searchParams.get('timeframe') || '1D';

    const symbolResult = tickerSchema.safeParse(symbolParam?.toUpperCase());
    const timeframeResult = timeframeSchema.safeParse(timeframeParam);

    if (!symbolResult.success) {
        return NextResponse.json({ error: 'Invalid symbol parameter', details: symbolResult.error.format() }, { status: 400 });
    }

    if (!timeframeResult.success) {
        return NextResponse.json({ error: 'Invalid timeframe parameter', details: timeframeResult.error.format() }, { status: 400 });
    }

    const symbol = symbolResult.data;
    const timeframe = timeframeResult.data;

    try {
        const data = await marketDataEngine.getHistoricalData(symbol, timeframe);
        return NextResponse.json(data);
    } catch (error) {
        console.error(`Error fetching historical data for ${symbol}:`, error);
        return NextResponse.json({ error: 'Failed to fetch historical data' }, { status: 500 });
    }
}
