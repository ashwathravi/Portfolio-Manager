# Deployment

Production runs on Vercel (project `atlas-wealth`, https://atlas-wealth-lovat.vercel.app) with the Supabase project as its database.

## How a change reaches production

1. A pull request runs `build`, `lint-and-test` and `e2e-tests`. Vercel also builds a preview of the branch, behind Vercel Authentication.
2. Merging to `master` runs the same checks again. When all three pass, two jobs start:
   - **`publish-image`** pushes the Docker image to GHCR (the portable fallback).
   - **`deploy-production`** (GitHub environment `production`):
     1. applies database migrations with `scripts/migrate.ts`, as the table owner;
     2. builds with the Vercel CLI using the Production environment variables;
     3. deploys the build to production;
     4. polls `/api/health/ready` until the app reports it can reach its database.

Vercel's own Git integration does not deploy `master` (`vercel.json` turns it off), so every production deploy has passed CI and has its migrations applied first.

## Migrations

Migrations run a few minutes before the new code goes live, while the previous deployment is still serving traffic. Every migration must therefore work with the code that is already running:

- Add first: new tables, nullable columns, or columns with defaults.
- Remove later: drop or rename a column in a follow-up release, after no deployed code reads it.

A failed migration stops the job before anything is deployed. Migrations are not rolled back automatically.

## Health checks

| Route | Meaning |
|---|---|
| `/api/health` | The process is up. No database call. Used by the Docker `HEALTHCHECK`. |
| `/api/health/ready` | The app can reach its database: 200, or 503 with `database: "not_configured"` or `"unavailable"`. Cached for 10 seconds. Both routes are public. |

## Scheduled jobs

Vercel Cron calls `GET /api/cron/daily` at 22:30 UTC on weekdays (`vercel.json`): 6:30 PM ET in summer, 5:30 PM in winter, after the close. Hobby runs a cron job once a day at most and may start it up to an hour late. Vercel sends `Authorization: Bearer <CRON_SECRET>`; the route compares it in constant time and answers 503 when `CRON_SECRET` is unset and 401 for a wrong token. One run at a time: a run holds a Postgres advisory lock (transaction-scoped, so it works through the pooler) until it finishes, and a request that arrives meanwhile, such as a manual run during the scheduled one, answers 409 `CRON_RUNNING` and runs nothing. The proxy lets `/api/cron/*` through without a session (limited to 10 calls a minute per IP), so every route there must check the secret itself (`createCronHandler` in `src/lib/jobs/cron.ts`).

The route runs these jobs in order; one failing doesn't stop the next:

| Job | What it does |
|---|---|
| `expired-sessions` | Deletes Auth.js sessions whose expiry has passed and reports how many. |
| `prices` | The nightly price ingest (`src/lib/markets/price-ingest.ts`): tracks every held symbol and the benchmark ETFs, stores each missed trading day from Massive's grouped daily bars for every tracked symbol (an empty day followed by a published one is recorded as a closure and passed) (those, plus symbols quotes were asked for, up to 2,000 tracked securities in all), up to five days a run, then backfills two years of history for newly tracked symbols until its 240-second budget runs out: held symbols and benchmarks first, and a looked-up symbol only once a daily file has priced it. A looked-up symbol no daily file prices within a week stops being tracked. Before storing any day it asks Massive (`/stocks/v1/splits`) which stocks split on those days; a tracked stock that split has its stored (old-scale) bars deleted and goes back in the backfill queue first, so a post-split price never sits beside them; its history is replaced on the new scale. A replacement is written only when the refetched history covers every stored day from its start through the newest; otherwise nothing changes and the symbol stays queued. A history with a session the provider sent unreadable or inconsistent is written but leaves the symbol queued for a clean retry, so a missing day is never marked as done. A tracked symbol whose bar in a day's file is invalid, or that a daily file prices for the first time after an empty backfill, also goes back in the queue before that day is stored. The queue takes held symbols and benchmarks first; within each group, never-tried symbols first, then retries least recently tried first (`securities.history_attempted_at`), so persistent failures can't block their group. Requests go through a pacer (five a minute) with no retries inside the adapter, and each takes a token from the Massive budget shared with the app's history, fundamentals and search requests (`src/lib/providers/massive-quota.ts`, in Upstash Redis when it is configured); a rate limit is waited out while the 240-second budget lasts. Skips (and succeeds) without `POLYGON_API_KEY`. |

The response is 200 when every job succeeded and 500 when any failed, with each job's outcome. Every run is also a row in `job_runs` (`status` is `running`, `succeeded` or `failed`; `detail` holds what the job reported; a row left `running` was cut off). To see the latest runs:

```sql
select job, started_at, finished_at, status, error, detail
from job_runs order by started_at desc limit 10;
```

To run the jobs by hand, use **Run** next to the job in the Vercel dashboard (Settings → Cron Jobs), which sends the secret for you.

The route sets `maxDuration = 300`, the most Hobby allows, which needs Fluid compute (on by default for new projects).

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
| `AUTH_ALLOWED_EMAILS` | Comma-separated invite list. Required: without it production refuses sign-in. |
| `DATABASE_URL` | Supabase **transaction** pooler (port 6543) as `atlas_app.<project-ref>`, the least-privilege login (see `docs/local-database-secrets.md`). |
| `CRON_SECRET` | A generated value (`openssl rand -hex 32`). Vercel sends it to the cron route; without it no scheduled job runs. Never print or paste it. |
| `POLYGON_API_KEY` | The Massive Basic key the nightly price ingest uses. |
| `PLAID_*`, `PLAID_TOKEN_ENCRYPTION_KEY` | When account linking goes live. |

```bash
vercel env add AUTH_ALLOWED_EMAILS production
# Generates the cron secret and pipes it straight in, so it is never shown:
openssl rand -hex 32 | tr -d '\n' | vercel env add CRON_SECRET production
```

## Rolling back

Promote the previous deployment in the Vercel dashboard (Deployments → ⋯ → Promote) or run `vercel rollback`. This rolls back code only; a migration that already ran stays applied, which the add-first rule above makes safe.
