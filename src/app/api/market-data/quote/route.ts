/**
 * GET /api/market-data/quote?symbol=AAPL
 *
 * Returns a single real-time quote via MarketDataService.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { apiError, internalServerError, providerRateLimitError } from '@/lib/api/security';
import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';
import { tickerSchema } from '@/lib/validators/market-data';

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol');

  if (!symbol) {
    return apiError('Missing required query parameter: symbol', 'MISSING_SYMBOL', 400);
  }

  const parsedSymbol = tickerSchema.safeParse(symbol.toUpperCase());
  if (!parsedSymbol.success) {
    return apiError(parsedSymbol.error.issues[0]?.message ?? 'Invalid symbol', 'INVALID_SYMBOL', 400);
  }

  try {
    const service = getMarketDataService();
    const quote = await service.getQuote(parsedSymbol.data);
    return NextResponse.json({ data: quote });
  } catch (err) {
    if (err instanceof PolygonRateLimitError) {
      return providerRateLimitError(err.retryAfterMs / 1000);
    }

    return internalServerError(err, 'Unable to fetch quote.', 'MARKET_DATA_QUOTE_FAILED');
  }
}
