/**
 * GET /api/market-data/history?symbol=AAPL&range=1M
 *
 * Returns historical OHLC bars via MarketDataService.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';

const VALID_RANGES = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y', 'MAX'];

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol');
  const range = request.nextUrl.searchParams.get('range');

  if (!symbol) {
    return NextResponse.json(
      { error: 'Missing required query parameter: symbol' },
      { status: 400 },
    );
  }

  if (!range) {
    return NextResponse.json(
      { error: 'Missing required query parameter: range' },
      { status: 400 },
    );
  }

  const upperRange = range.toUpperCase();
  if (!VALID_RANGES.includes(upperRange)) {
    return NextResponse.json(
      { error: `Invalid range. Valid values: ${VALID_RANGES.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const service = getMarketDataService();
    const bars = await service.getHistoricalPrices(symbol.toUpperCase(), upperRange);
    return NextResponse.json({ data: bars });
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
