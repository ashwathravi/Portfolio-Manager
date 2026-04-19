/**
 * GET /api/market-data/fundamentals?symbol=AAPL
 *
 * Returns fundamental / reference data via MarketDataService.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json(
      { error: 'Missing required query parameter: symbol' },
      { status: 400 },
    );
  }

  try {
    const service = getMarketDataService();
    const fundamentals = await service.getFundamentals(symbol.toUpperCase());
    return NextResponse.json({ data: fundamentals });
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
