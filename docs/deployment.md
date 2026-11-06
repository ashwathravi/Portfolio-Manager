# Deployment

Production runs on Vercel (project `atlas-wealth`, https://atlas-wealth-lovat.vercel.app) with the Supabase project as its database.

## How a change reaches production

1. A pull request runs `build`, `lint-and-test` and `e2e-tests`. Vercel also builds a preview of the branch, behind Vercel Authentication.
2. Merging to `master` runs the same checks again. When all three pass, two jobs start:
   - **`publish-image`** pushes the Docker image to GHCR (the portable fallback).
   - **`deploy-production`** (GitHub environment `production`):
     1. applies database migrations with `scripts/migrate.ts`, as the table owner;
     2. uploads the commit with `vercel deploy --prod`; Vercel builds it with the Production environment variables and deploys it (CI passes the commit as `SENTRY_RELEASE`);
     3. polls `/api/health/ready` until the app reports it can reach its database;
     4. runs the post-deploy smoke test against the live site (below).

Vercel runs the build, not CI: Sensitive variables (the Sentry DSN and its source-map upload token among them) only exist inside Vercel's own builds and functions. `vercel pull` hands them over as `[SENSITIVE]` placeholders, so a build on the CI runner would ship without error monitoring.

Vercel's own Git integration does not deploy `master` (`vercel.json` turns it off), so every production deploy has passed CI and has its migrations applied first.

## Migrations

Migrations run a few minutes before the new code goes live, while the previous deployment is still serving traffic. Every migration must therefore work with the code that is already running:

- Add first: new tables, nullable columns, or columns with defaults.
- Remove later: drop or rename a column in a follow-up release, after no deployed code reads it.

A failed migration stops the job before anything is deployed. Migrations are not rolled back automatically.

## Health checks

| Route | Meaning |
|---|---|
| `/api/health` | The process is up, and `release` is the commit it was built from (`SENTRY_RELEASE`, or null). No database call. Used by the Docker `HEALTHCHECK`. |
| `/api/health/ready` | The app can reach its database: 200, or 503 with `database: "not_configured"` or `"unavailable"`. Cached for 10 seconds. |
| `/api/health/jobs` | Every scheduled job, the backup included, has succeeded since its last run fell due: 200, or 503 with each job `ok`, `late` or `failed` and when it last succeeded, never an error. Cached for a minute. |

All three are public. The production monitor (`.github/workflows/production-monitor.yml`) reads the last two every half hour and keeps an issue open while either fails; see `docs/monitoring.md`.

## Scheduled jobs

Vercel Cron calls `GET /api/cron/daily` at 22:30 UTC on weekdays (`vercel.json`): 6:30 PM ET in summer, 5:30 PM in winter, after the close. Hobby runs a cron job once a day at most and may start it up to an hour late. Vercel sends `Authorization: Bearer <CRON_SECRET>`; the route compares it in constant time and answers 503 when `CRON_SECRET` is unset and 401 for a wrong token. One run at a time: a run holds a Postgres advisory lock (transaction-scoped, so it works through the pooler) until it finishes, and a request that arrives meanwhile, such as a manual run during the scheduled one, answers 409 `CRON_RUNNING` and runs nothing. The proxy lets `/api/cron/*` through without a session (limited to 10 calls a minute per IP), so every route there must check the secret itself (`createCronHandler` in `src/lib/jobs/cron.ts`).

The route runs these jobs in order; one failing doesn't stop the next:

| Job | What it does |
|---|---|
| `expired-sessions` | Deletes Auth.js sessions whose expiry has passed and reports how many. |
| `ask-history` | Deletes Ask messages (`ask_messages`, launch item i56) older than a day that the user cleared or that are past their last 50, and reports how many: what the privacy policy promises, even for a user who never asks again. |
| `prices` | The nightly price ingest (`src/lib/markets/price-ingest.ts`): tracks every held symbol and the benchmark ETFs, stores each missed trading day from Massive's grouped daily bars for every tracked symbol (an empty day followed by a published one is recorded as a closure and passed) (those, plus symbols quotes were asked for, up to 2,000 tracked securities in all), up to five days a run, then backfills two years of history for newly tracked symbols until its 240-second budget runs out: held symbols and benchmarks first, and a looked-up symbol only once a daily file has priced it. A looked-up symbol no daily file prices within a week stops being tracked. Before storing any day it asks Massive (`/stocks/v1/splits`) which stocks split on those days; a tracked stock that split has its stored (old-scale) bars deleted and goes back in the backfill queue first, so a post-split price never sits beside them; its history is replaced on the new scale. Held positions in a stock that split are moved to the new share count (quantity times the ratio, average cost divided by it; `src/lib/portfolio/split-adjustments.ts`), once per position: only positions last updated before the split took effect (midnight Eastern on its execution date), so a position re-imported after it is left alone. This runs separately from the price catch-up: each run asks Massive for every split of the held stocks since their oldest position was last updated, so a split the catch-up never saw (before the first run, say) is applied too, and seeing the same split again changes nothing. Several actions for one stock on one day are combined into one ratio (only when each has a provider id; otherwise they're ambiguous). A held stock with a split that can't be applied safely is listed in the job's `holdingSplits` detail as `unadjusted`; a failed check is reported there and retried next run, without holding up prices. A replacement is written only when the refetched history covers every stored day from its start through the newest; otherwise nothing changes and the symbol stays queued. A history with a session the provider sent unreadable or inconsistent is written but leaves the symbol queued for a clean retry, so a missing day is never marked as done. A tracked symbol whose bar in a day's file is invalid, or that a daily file prices for the first time after an empty backfill, also goes back in the queue before that day is stored. The queue takes held symbols and benchmarks first; within each group, never-tried symbols first, then retries least recently tried first (`securities.history_attempted_at`), so persistent failures can't block their group. Requests go through a pacer (five a minute) with no retries inside the adapter, and each takes a token from the Massive budget shared with the app's history, fundamentals and search requests (`src/lib/providers/massive-quota.ts`, in Upstash Redis when it is configured); a rate limit is waited out while the 240-second budget lasts. Before the history backfill it fetches reference data (the securities master, launch item i34: name, security type, SIC industry code, mapped to a sector by `src/lib/markets/security-profile.ts`) for at most five symbols a run that have none or a copy over 90 days old, held symbols and benchmarks first; a ticker Massive doesn't know is recorded and not asked about again until then, and a failed fetch is retried on later runs behind symbols not yet tried (`securities.reference_attempted_at`), so one that keeps failing can't hold the others back (`reference` in the run's detail). Skips (and succeeds) without `POLYGON_API_KEY`. |
| `snapshots` | Valuation snapshots (`src/lib/portfolio/valuation-snapshots.ts`): each portfolio's value at the newest stored close (holdings × close + cash), with each position, in `portfolio_snapshots` and `portfolio_snapshot_positions`. A day is recorded only if nothing in the portfolio changed after its close, so a snapshot is what the portfolio really held; missed days are filled from stored closes back to the last change (at most a year). A holding without a close from the past week is left out and listed as `unpriced`, and one valued at an earlier day's close (its own is missing) is provisional; either way the snapshot is recomputed on later runs until every position has that day's own close. Nothing is written until the latest `prices` run has checked held positions against splits through the newest stored close (its `holdingSplits` detail), and a portfolio still holding a position from before a split that couldn't be applied waits (`waitingForSplits`) until it is re-imported. The state is read in one repeatable-read transaction, so an import committing mid-run is seen whole or not at all. Uses only the database, so it runs quickly even when `prices` stopped early. |

The response is 200 when every job succeeded and 500 when any failed, with each job's outcome. Every run is also a row in `job_runs` (`status` is `running`, `succeeded` or `failed`; `detail` holds what the job reported; a row left `running` was cut off). To see the latest runs:

```sql
select job, started_at, finished_at, status, error, detail
from job_runs order by started_at desc limit 10;
```

To run the jobs by hand, use **Run** next to the job in the Vercel dashboard (Settings → Cron Jobs), which sends the secret for you. A job that hasn't succeeded by midnight UTC after its weekday run shows as late or failed in `/api/health/jobs`, and the production monitor opens an issue (`docs/monitoring.md`). Changing the schedule in `vercel.json` means changing `DAILY_JOBS_CRON` in `src/lib/health/job-health.ts` too (a test checks).

A second cron, `GET /api/cron/alpha-radar` at 11:15 UTC every day, runs one job, `alpha-radar` (launch item i60, `src/lib/alpha-radar/daily-refresh.ts`): it asks SEC for every enabled Alpha Radar filer's recent 13F filings and parses, compares and writes a report for each new one. Filers checked longest ago (`alpha_radar_tracked_filers.last_refreshed_at`) go first, and none is started after 240 seconds, so the rest go first the next day. SEC requests stop at 270 seconds, and a `Retry-After` longer than 10 seconds isn't waited for, so the run is always recorded within the route's five minutes. It is gated, locked and recorded like the nightly route, with its own five minutes, so it never takes time from the price backfill. Without `SEC_EDGAR_USER_AGENT` it asks SEC nothing and fails, and so does a run in which every filer failed; a run where only some failed succeeds and names them in its `detail`. Its schedule is `ALPHA_RADAR_CRON` in `src/lib/health/job-health.ts` (a test checks it against `vercel.json`). A deploy that adds a job shows it as late until its first scheduled run; **Run** in Settings → Cron Jobs clears that sooner.

The route sets `maxDuration = 300`, the most Hobby allows, which needs Fluid compute (on by default for new projects).

## Error monitoring

Sentry (Vercel Marketplace, Developer plan) receives errors from production and previews; it starts only where `NEXT_PUBLIC_SENTRY_DSN` is set, so local runs and E2E send nothing.

- **Server**: `src/instrumentation.ts` starts the SDK and reports every error thrown while rendering or in a route handler, tagged with the request ID (`x-vercel-id`). Errors the app handles itself are reported too: a route answering 500 through `internalServerError` (tagged with its error code) and a failed scheduled job (tagged with the job name).
- **Browser**: `src/instrumentation-client.ts` starts the SDK; `error.tsx` and `global-error.tsx` report what they catch, except server errors, which were already reported with their full stack trace.
- **What it sends**: the error, its stack trace, the route, the release (commit) and the request ID. Cookies, headers other than `user-agent`, `accept`, `content-type` and the request ID, request and response bodies, query strings, database query parameters, local variables and user details are turned off, and before an event leaves the app every string is checked for secret values and has URL queries cut (a provider's error message quotes its request URL, which can hold a search the user typed; stack frames keep theirs for source maps) (`src/lib/observability/sentry-options.ts`). No performance tracing, session tracking or session replay.
- **Source maps**: uploaded by Vercel's build with `SENTRY_AUTH_TOKEN`, then deleted from the build, so they are never served.
- **IP addresses**: the SDK never adds one to a report, but browsers send reports to Sentry directly, and Sentry can record the connection's address unless the project's **Prevent Storing of IP Addresses** setting (Project Settings → Security & Privacy) is on. Turn it on; the privacy policy only says Sentry *sees* the address.
- **CSP**: `connect-src` allows the DSN's ingest host only.
- **Request IDs**: API log events (`logApiEvent`) carry `requestId`, the same `x-vercel-id` that Vercel's runtime logs and Sentry show, so a report and its log lines can be matched.

## One-time setup

Already done: the `production` GitHub environment (deployments from `master` only), and the repository variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` and `PRODUCTION_URL`.

### GitHub secrets (environment `production`)

`gh` prompts for each value without echoing it:

```bash
gh secret set VERCEL_TOKEN --env production
gh secret set DATABASE_MIGRATION_URL --env production
```

- `VERCEL_TOKEN`: create one at vercel.com → Account Settings → Tokens, scoped to the `ashwathravi-7247's projects` team.
- `DATABASE_MIGRATION_URL`: the Supabase **session** pooler (port 5432) as the `postgres` owner, ending in `?sslmode=require`.

The old repository secret `DATABASE_URL` is no longer used by any workflow and can be deleted (`gh secret delete DATABASE_URL`).

### Vercel environment variables (Production only)

Set these for **Production only**, never Preview: a preview runs branch code, and must not reach production data or credentials.

| Variable | Value |
|---|---|
| `AUTH_SECRET` | Set. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | From the Google OAuth client (redirect URI `https://atlas-wealth-lovat.vercel.app/api/auth/callback/google`). |
| `AUTH_ALLOWED_EMAILS` | Comma-separated invite list. Required while sign-up is by invitation: without it (or `AUTH_OPEN_SIGNUP`) production refuses sign-in. |
| `AUTH_OPEN_SIGNUP` | Unset during the private beta. `1` opens sign-up to any verified Google account and ignores the invite list (launch item i77): see Opening sign-up below. |
| `AUTH_SIGNUP_DAILY_LIMIT` | Optional, with open sign-up: the most new accounts made in a UTC day, 50 unless set. Someone who already has an account always signs in; a new one past the limit is asked to come back tomorrow. |
| `AUTH_BLOCKED_EMAILS`, `AUTH_BLOCKED_DOMAINS` | Optional. Comma-separated emails or domains never let in, whether sign-up is open or not. A domain is matched against the email's domain and the Google Workspace the user signs in with, which can differ. Adding someone ends their sessions on their next request; their data stays until it's deleted. While a domain is blocked, each session read also reads the user's Workspace from the Google ID token stored when they first signed in. |
| `AUTH_ADMIN_EMAILS` | Who may change Alpha Radar's tracked filers and refresh them from SEC EDGAR (shared by every user). Usually just you. Nobody when unset: the Refresh buttons don't show and those routes answer 403. |
| `DATABASE_URL` | Supabase **transaction** pooler (port 6543) as `atlas_app.<project-ref>`, the least-privilege login (see `docs/local-database-secrets.md`). |
| `CRON_SECRET` | A generated value (`openssl rand -hex 32`). Vercel sends it to the cron route; without it no scheduled job runs. Never print or paste it. |
| `POLYGON_API_KEY` | The Massive Basic key the nightly price ingest uses. |
| `FINNHUB_API_KEY` | The Finnhub free key for delayed intraday quotes (launch item i33). During the session, and until the nightly ingest stores the day's close, a tracked US stock is priced from a Finnhub quote kept in `intraday_quotes` and fetched about every 80 seconds; the whole app stays under 50 calls in any minute (`src/lib/markets/intraday-quotes.ts`). Without it every price is the stored close. |
| `SEC_EDGAR_USER_AGENT` | Set. Who SEC EDGAR requests say they're from, with a contact (SEC fair-access rules): Alpha Radar's daily job and refreshes, and the nightly job's copy of SEC's ticker file for ticker search (launch item i35). Required: without it no SEC request is made (launch item i60), the `alpha-radar` job fails and an admin's refresh answers 503 `SEC_NOT_CONFIGURED`. |
| `PLAID_*`, `PLAID_TOKEN_ENCRYPTION_KEY` | When account linking goes live. The key must be 32 random bytes, base64 or hex (`openssl rand -base64 32`); production stores no Plaid token with a weaker one. `PLAID_ENV` is `sandbox` or `production`. |
| `PLAID_REDIRECT_URI` | With account linking: `https://<production domain>/settings`, added first to the Plaid Dashboard's allowed redirect URIs (Developers › API). Banks that sign in through OAuth send the user back there when Link can't open them in a pop-up, on phones especially, and Settings finishes the connection (launch item i47). Link refuses to open while it isn't on the Dashboard's list, and the app refuses one that isn't Settings on https. |
| `ASK_MODEL` | Optional (launch item i59). An AI Gateway model ID, such as `anthropic/claude-sonnet-5.5` (the live list: `curl https://ai-gateway.vercel.sh/v1/models`), makes Claude write Ask's answers; unset, the rules planner does. On Vercel the gateway authenticates with the deployment's OIDC token, so no key is needed; enable AI Gateway for the team first. A question costs at most about 15 cents with `claude-sonnet-5.5` (4 model calls of at most 2,000 output tokens each, reasoning included), and each user asks at most 30 a day; set a budget on the gateway (`vercel ai-gateway budgets set --help`) as the ceiling. When the gateway fails (no credits, a budget reached, an outage) the rules answer and Sentry gets `ASK_CLAUDE_FAILED`, without the question or data. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (and `KV_URL`, `REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN`) | Set by the Upstash integration. They are the shared rate limiter's store; without them each instance limits on its own. |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (and `SENTRY_PUBLIC_KEY`, `SENTRY_VERCEL_LOG_DRAIN_URL`, `SENTRY_OTLP_TRACES_URL`, which the app doesn't read) | Set by the Sentry integration (Production and Preview). Don't edit them by hand. |

`AUTH_URL` stays unset on Vercel: Auth.js uses the request's host there. Every variable is described in `.env.example`.

```bash
vercel env add AUTH_ALLOWED_EMAILS production
vercel env add AUTH_ADMIN_EMAILS production
# Generates the cron secret and pipes it straight in, so it is never shown:
openssl rand -hex 32 | tr -d '\n' | vercel env add CRON_SECRET production
```

### Opening sign-up (phase 5)

Sign-up stays by invitation until the plans allow public use (launch item i76): Vercel Pro, Supabase Pro, a market-data plan whose terms allow it, and Plaid Production's pricing. Then:

1. Check `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set. The daily quotas and the limit on new accounts are counted in the shared Upstash store; without it each instance counts on its own.
2. `vercel env add AUTH_OPEN_SIGNUP production` with the value `1`, and `AUTH_SIGNUP_DAILY_LIMIT` if 50 new accounts a day is the wrong ceiling. Environment changes reach the next deployment, so redeploy. The terms and the privacy policy then say the beta is public, and the terms no longer ask for an invitation.
3. Watch Sentry and the AI Gateway and Plaid dashboards for the first days, and block an abuser with `AUTH_BLOCKED_EMAILS` (or a throwaway domain with `AUTH_BLOCKED_DOMAINS`), then redeploy.

What each user can do in a day, besides the per-minute rate limits (`src/lib/api/daily-quota.ts`, counted in UTC days):

| | A day | Refused with |
|---|---|---|
| CSV imports, holdings and transactions together | 20 | 429 `DAILY_QUOTA_REACHED` |
| Opening bank linking (a new connection or a reconnect) | 10 | 429 `DAILY_QUOTA_REACHED` |
| Syncing linked accounts on request (the nightly sync isn't counted) | 20 | 429 `DAILY_QUOTA_REACHED` |
| Backtests | 100 | 429 `DAILY_QUOTA_REACHED` |
| Ask questions | 30 in any 24 hours | 429 `ASK_DAILY_LIMIT` |

A user keeps at most 10 linked institutions at once (409 `PLAID_CONNECTION_LIMIT`; Plaid charges for each; counted as each is saved, one at a time per user, so links finishing together can't pass it), 50 accounts, 20 strategies and 5,000 order plans.

Closing sign-up again means unsetting `AUTH_OPEN_SIGNUP` with an invite list in place: everyone not on it is signed out on their next request, so add the people who should stay first.

## Post-deploy smoke test

After every production deploy (launch item i72), `deploy-production` waits until `/api/health` reports the commit it just deployed, up to three minutes, then runs a short Playwright suite against `PRODUCTION_URL`: `tests/production/post-deploy.spec.ts`, with `playwright.production.config.ts`. It checks, signed out:

- the site can reach its database, and `/api/health/jobs` reads every scheduled job (whether they ran on time is the production monitor's alert, not the deploy's);
- a signed-out visit to an app page goes to sign in, and the sign-in button is on;
- **Continue with Google** sends the browser to Google with a real client ID and this site's callback. The test answers that request itself, so Google's page never loads;
- the sign-in page, the privacy policy and the terms answer 200 with their security headers (a nonce-based Content-Security-Policy, HSTS, `X-Frame-Options`), and load without console errors, policy violations or failed requests to the site;
- those pages ask search engines to leave them out of their results (`noindex, nofollow` as a header and a meta tag, launch item i74), and `robots.txt` lets crawlers in to read that;
- the sign-in page fits a phone;
- the API refuses signed-out callers, and `/api/cron/daily` and `/api/cron/alpha-radar` refuse a call without the cron secret.

It is read-only: it never signs in, writes nothing and runs no job. A signed-in check would need a standing production account and its session token as a CI secret, so the pages behind sign-in are covered by E2E only.

Each run retries a failed test twice, so a network blip doesn't fail a deploy. A failure turns the job red, after the deploy is already live, and uploads the report as the `production-smoke-report` artifact. If the site is broken, roll back (below). The same suite runs in CI's E2E job against the local production build (project `production-smoke`), without the Google check, since E2E calls no real service.

To check production by hand, read-only like the job:

```bash
PRODUCTION_URL=https://atlas-wealth-lovat.vercel.app npm run test:production
```

Add `EXPECTED_RELEASE=<commit>` to wait for a commit first.

## Backups

`.github/workflows/database-backup.yml` dumps production every night, keeps the dump encrypted as a GitHub Actions artifact for 30 days, and restores it into a scratch database in the same run to check every table. The setup, the restore drill and the steps for recovering production are in `docs/backups.md`.

## Rolling back

Promote the previous deployment in the Vercel dashboard (Deployments → ⋯ → Promote) or run `vercel rollback`. This rolls back code only; a migration that already ran stays applied, which the add-first rule above makes safe.

After a rollback, Vercel stops giving new production deploys the domain until a deployment is promoted again. The next deploy job then fails its smoke test, because production still serves the old commit. Once the fix is deployed, promote that deployment (Deployments → ⋯ → Promote, or `vercel promote <deployment URL>`) to undo the rollback.
