/**
 * GET /api/market-data/quote?symbol=AAPL
 *
 * Returns a single quote via MarketDataService: the latest session's
 * closing price on the free Massive plan. 503 when no key is configured.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { apiError } from '@/lib/api/security';
import { marketDataErrorResponse } from '@/lib/api/market-data/route-errors';
import { getMarketDataService } from '@/lib/services/market-data-service';
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
    return marketDataErrorResponse(err, 'Unable to fetch quote.', 'MARKET_DATA_QUOTE_FAILED');
  }
}
