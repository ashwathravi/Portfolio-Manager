# Open Questions

_Last reviewed 2026-10-30._ Questions answered since the first version of this list are at the end, with where the answer lives.

## Open

- **When to leave the free tiers.** Vercel Hobby, the Massive and Finnhub free plans and Supabase's free plan are all for non-commercial use. Plan: upgrade before public sign-up or any paid use (launch item i76). Which market-data plan's terms fit is still to be chosen.
- **Intraday prices.** The app shows stored closes. Delayed quotes from Finnhub's free tier during market hours are planned (i33); whether that is enough before a paid feed (i78) is open.
- **Strategies.** Strategies and backtests are examples today. Saved strategies need a table and a backtest engine over `price_bars`, with two years of free history (i55).
- **Alerts.** Where price and Alpha Radar alerts are evaluated (the nightly job, or `pg_cron` for intraday) and how they reach the user (in-app, then email through Resend; i57, i58).
- **Signed-in production checks.** The post-deploy smoke test runs signed out. Checking pages behind sign-in would need a standing production account and its session token as a CI secret (`docs/test-coverage-analysis.md`).
- **Brokerage routing.** Atlas saves order plans and never routes orders. Whether it ever should, and with what guardrails, is open; the Schwab routes stay off until then.

## Answered

- *Where should Schwab OAuth tokens be stored?* Nowhere yet: the Schwab routes are off in production, and there is no broker routing at launch (`docs/decisions.md`).
- *Which pages become database-backed first?* All of them except Strategies (`docs/current-focus.md`).
- *Request-time analytics or persisted snapshots?* Both: nightly valuation snapshots in `portfolio_snapshots`, with returns and attribution computed from them at request time (`docs/architecture.md`).
- *How do linked broker accounts fit the `portfolios` table?* One linked account is one portfolio (`docs/decisions.md`).
- *Do theses, watchlists and journal entries become database entities?* Yes, with the account; strategies will too (`docs/decisions.md`).
