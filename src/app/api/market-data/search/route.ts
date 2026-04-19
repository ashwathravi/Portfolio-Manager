/**
 * GET /api/market-data/search?query=apple
 *
 * Returns symbol search results via MarketDataService.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query');

  if (!query) {
    return NextResponse.json(
      { error: 'Missing required query parameter: query' },
      { status: 400 },
    );
  }

  try {
    const service = getMarketDataService();
    const results = await service.searchSymbol(query);
    return NextResponse.json({ data: results });
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
