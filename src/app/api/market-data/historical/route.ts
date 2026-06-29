/**
 * GET /api/market-data/historical?symbol=AAPL&timeframe=1D
 *
 * Legacy historical endpoint — delegates to MarketDataService.
 * Prefer /api/market-data/history going forward.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { apiError, internalServerError, providerRateLimitError } from '@/lib/api/security';
import { getMarketDataService } from '@/lib/services/market-data-service';
import { PolygonRateLimitError } from '@/lib/providers/polygon-massive-adapter';
import { tickerSchema, timeframeSchema } from '@/lib/validators/market-data';

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol');
  const timeframe = request.nextUrl.searchParams.get('timeframe') || '1D';

  if (!symbol) {
    return apiError('Missing required query parameter: symbol', 'MISSING_SYMBOL', 400);
  }

  const parsedSymbol = tickerSchema.safeParse(symbol.toUpperCase());
  if (!parsedSymbol.success) {
    return apiError(parsedSymbol.error.issues[0]?.message ?? 'Invalid symbol', 'INVALID_SYMBOL', 400);
  }

  const parsedTimeframe = timeframeSchema.safeParse(timeframe.toUpperCase());
  if (!parsedTimeframe.success) {
    return apiError('Invalid timeframe. Valid values: 1D, 1H, 1M', 'INVALID_TIMEFRAME', 400);
  }

  try {
    const service = getMarketDataService();
    const bars = await service.getHistoricalPrices(
      parsedSymbol.data,
      parsedTimeframe.data,
    );
    return NextResponse.json({ data: bars });
  } catch (err) {
    if (err instanceof PolygonRateLimitError) {
      return providerRateLimitError(err.retryAfterMs / 1000);
    }

    return internalServerError(err, 'Unable to fetch historical prices.', 'MARKET_DATA_HISTORICAL_FAILED');
  }
}
