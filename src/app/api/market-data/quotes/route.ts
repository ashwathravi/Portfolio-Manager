/**
 * GET /api/market-data/quotes?symbols=AAPL,MSFT,GOOG
 *
 * Returns batch quotes via MarketDataService.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { apiError, internalServerError, providerRateLimitError } from '@/lib/api/security';
import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';
import { symbolsSchema } from '@/lib/validators/market-data';

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get('symbols');

  if (!symbolsParam) {
    return apiError('Missing required query parameter: symbols', 'MISSING_SYMBOLS', 400);
  }

  const parsedSymbols = symbolsSchema.safeParse(symbolsParam);
  if (!parsedSymbols.success) {
    return apiError(parsedSymbols.error.issues[0]?.message ?? 'Invalid symbols', 'INVALID_SYMBOLS', 400);
  }

  try {
    const service = getMarketDataService();
    const quotes = await service.getBatchQuotes(parsedSymbols.data);
    return NextResponse.json({ data: quotes });
  } catch (err) {
    if (err instanceof PolygonRateLimitError) {
      return providerRateLimitError(err.retryAfterMs / 1000);
    }

    return internalServerError(err, 'Unable to fetch quotes.', 'MARKET_DATA_QUOTES_FAILED');
  }
}
