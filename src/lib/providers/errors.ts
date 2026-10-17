/**
 * Provider-agnostic market-data errors (launch item i30).
 *
 * Provider-specific failures (rate limits, HTTP errors, timeouts) stay next
 * to their adapter; this module holds the ones every adapter shares.
 */

/**
 * Thrown by every request method of an adapter that has no API key. It is
 * the expected state locally and in E2E, so callers answer it quietly:
 * pages fall back to stored prices and routes answer 503.
 */
export class MarketDataNotConfiguredError extends Error {
  constructor(setting: string) {
    super(`Market data is not configured: set ${setting} to enable it.`);
    this.name = 'MarketDataNotConfiguredError';
  }
}
