/**
 * GET /api/market-data/quotes?symbols=AAPL,MSFT,GOOG
 *
 * Returns batch quotes via MarketDataService.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get('symbols');

  if (!symbolsParam) {
    return NextResponse.json(
      { error: 'Missing required query parameter: symbols' },
      { status: 400 },
    );
  }

  const symbols = symbolsParam
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json(
      { error: 'No valid symbols provided' },
      { status: 400 },
    );
  }

  try {
    const service = getMarketDataService();
    const quotes = await service.getBatchQuotes(symbols);
    return NextResponse.json({ data: quotes });
  } catch (err) {
    if (err instanceof PolygonRateLimitError) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please retry later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(err.retryAfterMs / 1000)) } },
      );
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
