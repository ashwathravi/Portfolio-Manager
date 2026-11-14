# Current Focus

_Last updated 2026-11-14, during phase 4 of the production launch plan (private beta readiness). The launch tracker has each item's status._

## Information architecture

Eight destinations, defined once in `src/lib/navigation.ts` (sidebar, section
tabs, ⌘K palette, and legacy redirects all read from it):

| Destination | Routes | Data |
|---|---|---|
| Today | `/` | Net worth, what needs attention under the user's risk policy, the equity curve from nightly valuations, and the weekly review and patterns from closed trades: **the user's own data**. A labelled, hideable example section until there is enough of it. |
| Portfolio | `/portfolios/holdings`, `/portfolios/accounts`, `/portfolios/activity`, `/portfolios/detail/[symbol]` | **The user's own data**: entered by hand, imported from CSV, or synced through Plaid. Holdings by account, or one row per symbol across accounts (`?view=symbol`, i79); money moved between the user's own accounts is one transfer, not a deposit and a withdrawal (i80). LEAPS ledger: the user's option positions, entered by hand or from a positions CSV, marked at Massive's end-of-day close where its plan includes options (i63, #192); not yet in net worth or returns. |
| Performance | `/performance` (Returns), `/performance/attribution`, `/performance/behaviour` | Returns and attribution from nightly valuation snapshots; Behaviour from closed trades. A labelled example series before any history exists. |
| Research | `/research`, `/research/thesis/[ticker]` | Watchlist, journal and theses saved with the account (i38). Alpha Radar: 13F data from SEC EDGAR, shared by every user and managed by admins (i69), checked daily and followed per user, with Today showing the filers each user follows (i60). Each filing's information table is read from its attachment, and its holdings and report are searchable evidence, by meaning too when embeddings are on (i62). |
| Strategies | `/strategies` (`/strategies/[id]` redirects with the strategy selected) | The user's strategies, saved with the account and backtested over stored prices (i55). Labelled, hideable examples. |
| Trade | `/execution` | The ticket on the user's accounts, at stored prices, checked against the risk policy, saved as an order plan. Never routes to a broker. |
| Ask | `/ask` (history) + ⌘K overlay | Tools over the user's own data; the conversation is kept with the account (i56). With `ASK_MODEL` set, Claude picks the tools and writes the answer through AI Gateway, the rules planner answering when it can't (i59). |
| Settings / Help | `/settings`, `/help` | Settings and the risk policy on the server; alert rules, checked each weekday evening, with their alerts in the top bar's bell (i57); email for alerts and the weekly review, off until the user turns it on, with a one-click unsubscribe (i58, `/unsubscribe`); Plaid connections, data export and account deletion. |

Retired routes redirect (307): `/portfolios`, `/portfolios/trade-log`,
`/analytics`, `/research/journal`, `/strategies/builder`, `/strategies/deploy`.

## Truthful data rules

- Every figure is either the user's own data or carries a **Sample** tag
  (`SampleTag`, `SampleDataNotice`). `SampleGate` hides example cards when
  Settings › Data › "Show example data" is off; a new user starts with it off.
- Prices are stored daily closes from Massive or, during the session, delayed
  Finnhub quotes, labelled as such; never live quotes (i33).
- Ticker search reads a nightly copy of SEC's list of listed companies, plus
  the benchmark ETFs and the user's own holdings; never other users' (i35).
- Nothing is investment advice, and Atlas never places trades (`/terms`).

## Next

- **Before the first invite (phase 4):** clear the dev data from production
  (i70), `POLYGON_API_KEY` for the nightly prices (the `prices` job fails
  without it, so the production monitor keeps an issue open until it's set)
  and `FINNHUB_API_KEY` for delayed quotes (i08). The features merged on
  2026-11-14 stay off until their settings are in Vercel: `RESEND_API_KEY`
  and `EMAIL_FROM` on a domain verified in Resend, so alert and
  weekly-review emails can go (i58; until then Settings says the server
  doesn't send email yet), and `ASK_MODEL`, with AI Gateway enabled
  and a budget set, so Claude writes Ask's answers (i59;
  `ALPHA_RADAR_EMBEDDING_MODEL` is optional, i62). Then Plaid's approval
  (i09, i67), with `PLAID_REDIRECT_URI` for banks that sign in through OAuth
  (i47) and `PLAID_WEBHOOK_URL` before the first link
  (`docs/deployment.md`). Every page already asks search engines to stay
  away during the beta, and Supabase's Data API is off. `CRON_SECRET` and
  `AUTH_ADMIN_EMAILS` were set on 2026-10-30.
- **Product gaps:** option positions (i63, #192) are in the LEAPS ledger and
  the risk policy's options checks, but not yet in net worth, returns or
  Plaid syncs.
- **Public launch (phase 5):** invite the first users (i75), upgrade plans
  (i76), then open sign-up: `AUTH_OPEN_SIGNUP`, with the per-user daily
  quotas, the caps on what each user keeps (alert rules, and with #203 the
  watchlist, journal, theses and transactions), the limit on new accounts a
  day and the block list already in place (i77, `docs/deployment.md` ›
  Opening sign-up).
