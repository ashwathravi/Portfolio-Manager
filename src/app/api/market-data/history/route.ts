/**
 * GET /api/market-data/history?symbol=AAPL&range=1M
 *
 * Returns historical OHLC bars via MarketDataService.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { apiError, internalServerError, providerRateLimitError } from '@/lib/api/security';
import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';
import { historyRangeSchema, tickerSchema } from '@/lib/validators/market-data';

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol');
  const range = request.nextUrl.searchParams.get('range');

  if (!symbol) {
    return apiError('Missing required query parameter: symbol', 'MISSING_SYMBOL', 400);
  }

  if (!range) {
    return apiError('Missing required query parameter: range', 'MISSING_RANGE', 400);
  }

  const parsedSymbol = tickerSchema.safeParse(symbol.toUpperCase());
  if (!parsedSymbol.success) {
    return apiError(parsedSymbol.error.issues[0]?.message ?? 'Invalid symbol', 'INVALID_SYMBOL', 400);
  }

  const parsedRange = historyRangeSchema.safeParse(range.toUpperCase());
  if (!parsedRange.success) {
    return apiError('Invalid range. Valid values: 1D, 5D, 1M, 3M, 6M, 1Y, 5Y, MAX', 'INVALID_RANGE', 400);
  }

  try {
    const service = getMarketDataService();
    const bars = await service.getHistoricalPrices(parsedSymbol.data, parsedRange.data);
    return NextResponse.json({ data: bars });
  } catch (err) {
    if (err instanceof PolygonRateLimitError) {
      return providerRateLimitError(err.retryAfterMs / 1000);
    }

    return internalServerError(err, 'Unable to fetch historical prices.', 'MARKET_DATA_HISTORY_FAILED');
  }
}
