/**
 * GET /api/portfolio/[id]/value
 *
 * Returns the live portfolio valuation (holdings + current prices)
 * via PortfolioValuationEngine (delegated through MarketDataService).
 *
 * Response shape:
 *   { data: PortfolioValuation }
 *
 * The `errors` array lists any symbols whose prices could not be fetched.
 * The `valuedAt` field is the epoch-ms timestamp of the valuation snapshot.
 *
 * Linear: AR-48, AR-49
 */

import { NextRequest, NextResponse } from 'next/server';

import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: 'Missing required path parameter: id' },
      { status: 400 },
    );
  }

  try {
    const service = getMarketDataService();
    const valuation = await service.getPortfolioValue(id);

    // Surface partial failures at the HTTP level while still returning data
    const status = valuation.errors.length > 0 ? 206 : 200;

    return NextResponse.json({ data: valuation }, { status });
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
