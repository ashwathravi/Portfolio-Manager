import { NextResponse } from 'next/server';
import { marketDataEngine } from '@/lib/api/market-data';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const timeframe = searchParams.get('timeframe') as '1D' | '1H' | '1M' || '1D';

    if (!symbol) {
        return NextResponse.json({ error: 'Missing symbol parameter' }, { status: 400 });
    }

    try {
        const data = await marketDataEngine.getHistoricalData(symbol.toUpperCase(), timeframe);
        return NextResponse.json(data);
    } catch (error) {
        console.error(`Error fetching historical data for ${symbol}:`, error);
        return NextResponse.json({ error: 'Failed to fetch historical data' }, { status: 500 });
    }
}
