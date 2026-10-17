/**
 * GET /api/market-data/quotes?symbols=AAPL,MSFT,GOOG
 *
 * Returns batch quotes via MarketDataService: the latest session's closing
 * prices on the free Massive plan. A symbol without a price is left out of
 * `data`. 503 when no key is configured.
 * Linear: AR-48
 */

import { NextRequest, NextResponse } from 'next/server';

import { apiError } from '@/lib/api/security';
import { marketDataErrorResponse } from '@/lib/api/market-data/route-errors';
import { getMarketDataService } from '@/lib/services/market-data-service';
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
    return marketDataErrorResponse(err, 'Unable to fetch quotes.', 'MARKET_DATA_QUOTES_FAILED');
  }
}
