# Decisions

The choices behind the production launch, and why. The launch plan's tracker keeps the same list (its `decisions` collection). The **Approved** ones were confirmed explicitly; the rest were proposed in the plan and are what the code does today. Each one points to where it lives.

## Product and data

**Who can sign in: an invite-only private beta, multi-tenant underneath.** Production refuses sign-in without an invite list (`AUTH_ALLOWED_EMAILS` or `AUTH_ALLOWED_DOMAINS`), and every row belongs to a user. Public sign-up comes later (launch item i77), with per-user quotas. *Why:* it keeps free hosting and free market-data terms valid and limits exposure; opening up later is one setting plus abuse controls.

**Linked broker accounts: one linked investment account is one portfolio.** *Approved Oct 13.* A Plaid account becomes a `portfolios` row (source, external account id). CSV and manual portfolios sit alongside it. A sync replaces holdings and upserts transactions by their external id. The all-accounts view is the sum of your portfolios. *Why:* it fits the existing table and keeps CSV import working.

**What leaves the browser: everything a user owns.** *Approved Oct 13.* Preferences and the risk policy are one versioned JSON row (`user_settings`). Theses, the journal, the watchlist, order plans, Ask conversations and valuation snapshots have tables of their own. Strategies and alert rules will too (i55, i57). Browser storage keeps only per-browser conveniences, scoped to the signed-in user. *Why:* it fixes data leaking between accounts on a shared browser, and lets Ask, alerts and the nightly jobs work on the server.

**Every figure is real or labelled.** A number comes from the user's own data, or carries a **Sample** tag and can be hidden (Settings › Data). Nothing is fabricated to fill a card: no invented deltas, sparklines, commissions or prices. *Why:* the product's first principle is truth over vibes; an investing tool that makes up numbers can't be trusted with real ones.

**No broker routing at launch.** Trade saves order plans with their rationale, checked against the user's risk policy; it never places an order. The Schwab routes stay off in production (`SCHWAB_INTEGRATION_ENABLED`). *Why:* the Schwab order route could place real orders with one global token, with no guardrails, idempotency or audit trail.

**Ask: deterministic tools first.** Ask answers from the user's own data with a fixed set of tools (`POST /api/ask`), 30 questions a day. A Claude planner through AI Gateway is a later upgrade (i59). *Why:* it costs nothing per question and needs no model; the LLM is an upgrade, not a dependency.

**Alpha Radar is shared, and admins manage it.** The tracked filers and their 13F data are the same for every user; only `AUTH_ADMIN_EMAILS` may add, change or refresh them (i69). Per-user follows come later (i60). *Why:* every refresh calls SEC EDGAR, and one user's change reaches everyone.

## Infrastructure

**Hosting: Vercel Hobby during the beta, Pro before public or paid use.** The Docker image stays as a portable fallback (`README.md` › Running the production image). *Why:* native Next.js 16, a preview per pull request, cron and environment management built in. Hobby is for non-commercial use, and its cron runs once a day.

**Database: the existing Supabase project is production; local development and E2E use Docker Postgres.** Nothing local ever points at Supabase. *Why:* the free organisation already had two active projects, and local development writing to production through the sign-in bypass had to stop.

**The app connects with least privilege.** At runtime the app is a member of `app_runtime` (migration 0010), with only the grants it needs. The table owner is used only by migrations, from CI. *Why:* a bug or injection in the app can't alter the schema or reach what it was never granted (`docs/local-database-secrets.md`).

**Sign-in: Auth.js with Google and database sessions.** Sessions live in `auth_sessions`, not in a signed cookie. *Why:* deleting an account or removing someone from the invite list ends their sessions straight away.

**Market data: Massive Basic, stored in Postgres.** The nightly ingest stores each trading day's closes from Massive's grouped daily bars (one call for every US stock), and pages read prices from there, never from Massive. History, fundamentals and search call Massive within a shared budget of 5 calls a minute. Alpha Vantage was dropped. Finnhub's free delayed quotes are planned for intraday prices (i33). *Why:* the grouped call fits the free plan's limit. Both free tiers are for non-commercial use, so the plan is revisited before public launch (i76).

**Background jobs: one daily Vercel Cron.** `GET /api/cron/daily` runs the jobs in order (sessions, Ask history, Plaid, prices, snapshots) behind `CRON_SECRET` (`docs/deployment.md` › Scheduled jobs). Supabase `pg_cron` calling a secured route is the option if intraday alerts need it. *Why:* Hobby runs a cron job once a day, within about an hour of its time.

**Deploys go through CI.** Vercel's Git integration doesn't deploy `master`. The `deploy-production` job deploys only after every check passes: it applies migrations first, then deploys, then smoke-tests the live site. Migrations are add-first, because the old code is still running while they apply (`docs/deployment.md`). *Why:* nothing reaches production untested, or without its migrations.

**Shared rate limits in Upstash Redis.** Limits apply per IP and per user, in every instance alike, and are namespaced per environment. Without Upstash each process keeps its own. *Why:* serverless instances come and go; a per-instance limit protects nothing.

**A nonce-based Content-Security-Policy.** The proxy gives every response a fresh script nonce with `'strict-dynamic'`, so no injected script runs (i26). *Why:* the app shows financial data and opens Plaid Link; an XSS bug shouldn't be able to run code.

**Backups: a nightly encrypted dump, restored every time.** A GitHub workflow dumps production, encrypts it with `age` and keeps it as an artifact for 30 days. In the same run it restores the dump into a scratch database and checks every table (`docs/backups.md`). *Why:* Supabase's free plan has no point-in-time recovery, and a backup nobody has restored isn't a backup.

**Monitoring: a scheduled GitHub workflow that keeps one issue open.** Every half hour it checks `/api/health/ready` and `/api/health/jobs`, opens an issue that mentions the owner when something fails, and closes it once everything passes (`docs/monitoring.md`). Errors go to Sentry. *Why:* it's free, needs no new service, and alerts once per outage rather than every half hour.
