import { NextResponse } from 'next/server';
import { marketDataEngine } from '@/lib/api/market-data';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    if (!symbolsParam) {
        return NextResponse.json({ error: 'Missing symbols parameter' }, { status: 400 });
    }

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase());

    try {
        const quotes = await marketDataEngine.getQuotes(symbols);
        return NextResponse.json(quotes);
    } catch (error) {
        console.error('Error fetching quotes:', error);
        return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
    }
}
