import { NextResponse } from 'next/server';
import { marketDataEngine } from '@/lib/api/market-data';
import { symbolsSchema } from '@/lib/validators/market-data';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    const result = symbolsSchema.safeParse(symbolsParam);

    if (!result.success) {
        return NextResponse.json({ error: 'Invalid symbols parameter', details: result.error.format() }, { status: 400 });
    }

    const symbols = result.data;

    try {
        const quotes = await marketDataEngine.getQuotes(symbols);
        return NextResponse.json(quotes);
    } catch (error) {
        console.error('Error fetching quotes:', error);
        return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
    }
}
