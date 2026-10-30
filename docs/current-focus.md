# Current Focus

_Last updated 2026-10-30, during phase 4 of the production launch plan (private beta readiness). The launch tracker has each item's status._

## Information architecture

Eight destinations, defined once in `src/lib/navigation.ts` (sidebar, section
tabs, ⌘K palette, and legacy redirects all read from it):

| Destination | Routes | Data |
|---|---|---|
| Today | `/` | Net worth, what needs attention under the user's risk policy, the equity curve from nightly valuations, and the weekly review and patterns from closed trades: **the user's own data**. A labelled, hideable example section until there is enough of it. |
| Portfolio | `/portfolios/holdings`, `/portfolios/accounts`, `/portfolios/activity`, `/portfolios/detail/[symbol]` | **The user's own data**: entered by hand, imported from CSV, or synced through Plaid. LEAPS ledger: example positions (no options data yet, i63). |
| Performance | `/performance` (Returns), `/performance/attribution`, `/performance/behaviour` | Returns and attribution from nightly valuation snapshots; Behaviour from closed trades. A labelled example series before any history exists. |
| Research | `/research`, `/research/thesis/[ticker]` | Watchlist, journal and theses saved with the account (i38). Alpha Radar: 13F data from SEC EDGAR, shared by every user and managed by admins (i69). |
| Strategies | `/strategies` (`/strategies/[id]` redirects with the strategy selected) | **Example data**; edits are tab-local (i55). |
| Trade | `/execution` | The ticket on the user's accounts, at stored prices, checked against the risk policy, saved as an order plan. Never routes to a broker. |
| Ask | `/ask` (history) + ⌘K overlay | Deterministic tools over the user's own data; the conversation is kept with the account (i56). |
| Settings / Help | `/settings`, `/help` | Settings and the risk policy on the server, Plaid connections, data export and account deletion. |

Retired routes redirect (307): `/portfolios`, `/portfolios/trade-log`,
`/analytics`, `/research/journal`, `/strategies/builder`, `/strategies/deploy`.

## Truthful data rules

- Every figure is either the user's own data or carries a **Sample** tag
  (`SampleTag`, `SampleDataNotice`). `SampleGate` hides example cards when
  Settings › Data › "Show example data" is off; a new user starts with it off.
- Prices are stored daily closes from Massive, not live quotes.
- Nothing is investment advice, and Atlas never places trades (`/terms`).

## Next

- **Before the first invite (phase 4):** clear the dev data from production
  (i70), small hardening items (i74), `POLYGON_API_KEY` for the nightly
  prices (i08), and Plaid's approval (i09, i67). `CRON_SECRET` and
  `AUTH_ADMIN_EMAILS` were set on 2026-10-30.
- **Product gaps still on example data or missing:** delayed intraday quotes
  (i33), ticker search (i35), saved strategies and a real backtest engine
  (i55), server-side alerts and email (i57, i58), Alpha Radar follows and
  relevance per user (i60, i61), and options positions for the LEAPS ledger
  (i63).
- **Public launch (phase 5):** invite the first users (i75), upgrade plans
  (i76), then open sign-up with per-user quotas (i77).
