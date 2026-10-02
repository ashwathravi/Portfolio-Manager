# Current Focus

_Last updated 2026-10-01 after the design-review refinement pass._

## Information architecture

Eight destinations, defined once in `src/lib/navigation.ts` (sidebar, section
tabs, ⌘K palette, and legacy redirects all read from it):

| Destination | Routes | Data |
|---|---|---|
| Today | `/` | Net worth, today's change, recent activity: **database**. Risk policy: real holdings, cash, trades only. Weekly review, equity curve, patterns, watchlist, Alpha Radar: **example data** (labelled, hideable). |
| Portfolio | `/portfolios/holdings`, `/portfolios/accounts`, `/portfolios/activity`, `/portfolios/detail/[symbol]` | **Database** (portfolios, holdings, transactions). LEAPS ledger: example positions (no options feed yet). |
| Performance | `/performance` (Returns), `/performance/behaviour` | **Example data** until account history is stored. |
| Research | `/research`, `/research/thesis/[ticker]` | Theses and journal in localStorage (seeded examples tagged Sample); Alpha Radar from DB with seeded fallback. |
| Strategies | `/strategies` (`/strategies/[id]` redirects with the strategy selected) | **Example data**; edits are tab-local. |
| Trade | `/execution` | Ticket, policy checks, rationale: real rules. Prices, buying power, blotter: **example data**. Never routes to a broker. |
| Ask | `/ask` (history) + ⌘K overlay | Deterministic tool catalog over example data. |
| Settings / Help | `/settings`, `/help` | Local settings store (v15) + Plaid connections. |

Retired routes redirect (307): `/portfolios`, `/portfolios/trade-log`,
`/analytics`, `/research/journal`, `/strategies/builder`, `/strategies/deploy`.

## Truthful data rules

- Every figure is either from the database or carries a **Sample** tag
  (`SampleTag`, `SampleDataNotice`). `SampleGate` hides example cards when
  Settings › Data › "Show example data" is off.
- Settings v15 removed the seeded fake brokerage accounts and the
  "John Doe" profile; the viewer identity comes from the Auth.js session
  (`IdentityProvider`).

## Next

- Store account history (daily snapshots) so Performance can leave example data.
- Persist theses, journal, and strategies server-side (they are localStorage today).
- Options positions feed for the LEAPS ledger.
- Live quotes need `POLYGON_API_KEY` (or Alpha Vantage) — without one the sidebar indices show "—".
