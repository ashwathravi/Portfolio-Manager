/**
 * GET /api/market-data/search?query=apple
 *
 * Returns symbol search results via MarketDataService.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { apiError, internalServerError, providerRateLimitError } from '@/lib/api/security';
import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';
import { marketSearchQuerySchema } from '@/lib/validators/market-data';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query');

  if (!query) {
    return apiError('Missing required query parameter: query', 'MISSING_QUERY', 400);
  }

  const parsedQuery = marketSearchQuerySchema.safeParse(query);
  if (!parsedQuery.success) {
    return apiError(parsedQuery.error.issues[0]?.message ?? 'Invalid query', 'INVALID_QUERY', 400);
  }

  try {
    const service = getMarketDataService();
    const results = await service.searchSymbol(parsedQuery.data);
    return NextResponse.json({ data: results });
  } catch (err) {
    if (err instanceof PolygonRateLimitError) {
      return providerRateLimitError(err.retryAfterMs / 1000);
    }

    return internalServerError(err, 'Unable to search symbols.', 'MARKET_DATA_SEARCH_FAILED');
  }
}
