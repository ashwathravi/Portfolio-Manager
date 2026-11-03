/**
 * GET /api/market-data/search?query=apple
 *
 * Ticker search for the pickers and ⌘K (launch item i35): the symbol
 * directory, the benchmark ETFs and the signed-in user's own holdings
 * (symbol-directory.ts). Without a database, the market data provider's
 * search, which answers 503 without a key.
 *
 * Response: { data: TickerMatch[] }, best match first.
 */

import { NextRequest, NextResponse } from 'next/server';

import { usableDatabaseUrl } from '@/db/connection-options';
import { apiError, internalServerError } from '@/lib/api/security';
import { marketDataErrorResponse } from '@/lib/api/market-data/route-errors';
import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { exchangeName, searchTickers } from '@/lib/markets/symbol-directory';
import { getMarketDataService } from '@/lib/services/market-data-service';
import { marketSearchQuerySchema } from '@/lib/validators/market-data';
import type { TickerMatch } from '@/types/market-data';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('query');

  if (!query) {
    return apiError('Missing required query parameter: query', 'MISSING_QUERY', 400);
  }

  const parsedQuery = marketSearchQuerySchema.safeParse(query);
  if (!parsedQuery.success) {
    return apiError(parsedQuery.error.issues[0]?.message ?? 'Invalid query', 'INVALID_QUERY', 400);
  }

  if (usableDatabaseUrl(process.env.DATABASE_URL)) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    try {
      const data = await searchTickers(parsedQuery.data, { userId: auth.context.userId });
      return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      return internalServerError(err, 'Unable to search symbols.', 'MARKET_DATA_SEARCH_FAILED');
    }
  }

  try {
    const service = getMarketDataService();
    const results = await service.searchSymbol(parsedQuery.data);
    const data: TickerMatch[] = results.map((result) => ({
      symbol: result.symbol,
      name: result.name,
      exchange: exchangeName(result.primaryExchange),
      held: false,
    }));
    return NextResponse.json({ data });
  } catch (err) {
    return marketDataErrorResponse(err, 'Unable to search symbols.', 'MARKET_DATA_SEARCH_FAILED');
  }
}
