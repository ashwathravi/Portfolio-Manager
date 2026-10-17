import type { NextResponse } from "next/server";

import { apiError, internalServerError, providerRateLimitError } from "@/lib/api/security";
import { MarketDataNotConfiguredError, QuoteUnavailableError } from "@/lib/providers/errors";
import { PolygonRateLimitError } from "@/lib/providers/polygon-massive-adapter";

/**
 * The response a market-data route gives when the provider fails (launch
 * item i30). Every route under /api/market-data and the portfolio valuation
 * route share it, so the same failure always reads the same way:
 *
 * - no API key or database configured → 503 MARKET_DATA_NOT_CONFIGURED, not
 *   logged (the normal state locally and in E2E)
 * - a symbol with no stored price yet → 404 QUOTE_UNAVAILABLE
 * - provider rate limit → 429 with Retry-After
 * - anything else → 500 with the route's own message and code, logged
 */
export function marketDataErrorResponse(error: unknown, message: string, code: string): NextResponse {
    if (error instanceof MarketDataNotConfiguredError) {
        return apiError("Market data is not configured.", "MARKET_DATA_NOT_CONFIGURED", 503);
    }
    if (error instanceof QuoteUnavailableError) {
        return apiError(`No price for ${error.symbol} yet.`, "QUOTE_UNAVAILABLE", 404);
    }
    if (error instanceof PolygonRateLimitError) {
        return providerRateLimitError(error.retryAfterMs / 1000);
    }
    return internalServerError(error, message, code);
}
