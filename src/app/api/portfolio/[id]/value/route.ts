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

import { requireSessionApiUserScope } from '@/lib/api/session-security';
import { apiError } from '@/lib/api/security';
import { marketDataErrorResponse } from '@/lib/api/market-data/route-errors';
import { buildOwnedPortfolioQuery } from '@/lib/portfolio-repository';
import { getMarketDataService } from '@/lib/services/market-data-service';
import { PortfolioAccessError } from '@/lib/services/portfolio-valuation-engine';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id) {
    return apiError('Missing required path parameter: id', 'MISSING_PORTFOLIO_ID', 400);
  }

  const auth = await requireSessionApiUserScope(request);
  if (!auth.ok) return auth.response;

  try {
    // Verify ownership before asking for prices, so another user's
    // portfolio is always the tenant-safe 404, never a market-data error
    // (such as the 503 when no provider key is configured).
    const [ownedPortfolio] = await buildOwnedPortfolioQuery(auth.context.userId, id);
    if (!ownedPortfolio) {
      throw new PortfolioAccessError();
    }

    const service = getMarketDataService();
    const valuation = await service.getPortfolioValue(id, {
      userId: auth.context.userId,
    });

    // Surface partial failures at the HTTP level while still returning data
    const status = valuation.errors.length > 0 ? 206 : 200;

    return NextResponse.json({ data: valuation }, { status });
  } catch (err) {
    if (err instanceof PortfolioAccessError) {
      return apiError('Portfolio not found', 'PORTFOLIO_NOT_FOUND', 404);
    }

    return marketDataErrorResponse(err, 'Unable to value portfolio.', 'PORTFOLIO_VALUE_FAILED');
  }
}
