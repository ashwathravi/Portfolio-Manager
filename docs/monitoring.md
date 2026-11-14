# Monitoring

What watches production, how an alert reaches you, and what to do about each one (launch item i71). Errors inside requests and jobs go to Sentry as well (`docs/deployment.md` › Error monitoring).

## What is watched

Every half hour, `.github/workflows/production-monitor.yml` runs `scripts/monitor/run.mts` against the repository variable `PRODUCTION_URL`. It asks two public endpoints:

| Check | Endpoint | Fails when |
|---|---|---|
| The site and its database | `/api/health/ready` | No answer, an error page or a redirect (deployment protection, say), or the app can't reach its database or has none configured. |
| The nightly jobs | `/api/health/jobs` | `expired-sessions`, `ask-history`, `plaid`, `prices` or `snapshots` hasn't succeeded after 22:00 UTC on a weekday by midnight UTC. Vercel Hobby starts the 22:30 cron at any minute of that hour. `prices` fails without `POLYGON_API_KEY`. |
| Alpha Radar's SEC job | `/api/health/jobs` | `alpha-radar` hasn't succeeded after 11:00 UTC by 13:00 UTC (launch item i60). It runs every day; it fails without `SEC_EDGAR_USER_AGENT` or when every filer failed (SEC refusing Atlas, say). |
| The nightly backup | `/api/health/jobs` | The `backup` workflow hasn't succeeded after 06:00 UTC by 10:00 UTC. It's scheduled at 06:41, and GitHub sometimes starts scheduled runs late. |
| The stored closing prices | `/api/health/jobs` | The newest close in `price_bars` is older than the trading session before the one the last due `prices` run was for, or none is stored. That means two runs in a row stored no new day, even if they succeeded: a run that is rate-limited, out of its time budget or finds the day's file not yet published stops early and still counts as a success. One session behind is allowed, because the day's file may not be out by 22:30 UTC; the next run stores it. |
| The portfolio snapshots | `/api/health/jobs` | The newest close a successful `snapshots` run valued the portfolios at (`latest` in its `job_runs.detail`) is older than that same session, or no run has. A run skips, and still succeeds, while held positions haven't been checked against splits through the newest close, for example when the price run was rate-limited first. Portfolios that changed after the close or wait for a re-import after a split don't hold it back. |

The monitor waits 30 seconds and asks again, up to three times, before counting no answer, an error or an unreachable database. A late or failed job is a settled answer and isn't retried.

Each production deploy is also checked once, straight away, by the post-deploy smoke test in the deploy job (`docs/deployment.md` › Post-deploy smoke test). A failure there turns the deploy job red rather than opening an issue.

## How an alert reaches you

When a check fails, the monitor opens **one issue**, created by `github-actions`, and mentions the repository's owner, so GitHub emails you:
- When what fails changes, it comments on that issue.
- Once every check passes again, it closes the issue.

While the same things keep failing, it stays quiet. Make sure github.com › Settings › Notifications emails you about @mentions.

The workflow run itself fails only when the monitor couldn't check, or couldn't open or update the issue. GitHub then emails whoever last changed the workflow's schedule.

The repository is public, so the issue is too. It says which check failed and when, never an error message or any data. The errors are in `job_runs`, Sentry and the Vercel logs.

## `/api/health/jobs`

Public, like `/api/health/ready`. It answers 200 when every scheduled job has succeeded since its last run fell due and the stored closes and snapshots are recent enough, and 503 otherwise:

```json
{
  "status": "degraded",
  "database": "ok",
  "jobs": [
    { "job": "prices", "status": "failed", "lastSucceededAt": "2026-10-27T22:31:04.120Z", "dueSince": "2026-10-28T22:00:00.000Z" },
    { "job": "backup", "status": "ok", "lastSucceededAt": "2026-10-29T06:49:58.000Z", "dueSince": "2026-10-29T06:00:00.000Z" }
  ],
  "closes": { "status": "ok", "latest": "2026-10-27", "oldestAllowed": "2026-10-27" },
  "snapshots": { "status": "ok", "latest": "2026-10-27", "oldestAllowed": "2026-10-27" },
  "checkedAt": "2026-10-29T09:07:12.401Z"
}
```

- **`ok`:** succeeded since `dueSince`, the start of the scheduled hour of its most recent run that should be done by now. A manual run counts.
- **`failed`:** its run since then failed, or was cut off (still `running` after 15 minutes).
- **`late`:** nothing has run since then, or it never has (`lastSucceededAt` is null).
- **`closes`:** `latest` is the newest Eastern trading date in `price_bars` (null when none is stored), and `oldestAllowed` the oldest it may be: one session before the session that had closed when the last due `prices` run began (Friday's run on a weekend, and the calendar's holidays skipped). `status` is `stale` when `latest` is older, or null. It is `null` when the database couldn't be read.
- **`snapshots`:** the same, where `latest` is the newest close a successful `snapshots` run valued every portfolio it could at (null when none has).

The endpoint has a 3-second statement timeout. Its answer is reused for a minute, or for 10 seconds while the database is unavailable, when `database` is `"unavailable"` (or `"not_configured"`), `jobs` is empty and `closes` and `snapshots` are null.

The schedules live in `src/lib/health/job-health.ts`. Tests keep them equal to `vercel.json` and the backup workflow. The nightly jobs record their runs themselves (`src/lib/jobs/runner.ts`). The backup workflow records one row per run as its last step (`scripts/db/record-backup-run.ts`): `succeeded` only when the backup was kept and restored exactly.

## What to do

Find the problem's message from the issue below. To see the latest runs and their errors (Supabase › SQL editor):

```sql
select job, started_at, finished_at, status, error, detail
from job_runs order by started_at desc limit 20;
```

**"… didn't answer" or "… answered HTTP 5xx".** The site is down.
1. Check the latest deployment in Vercel › Deployments, and vercel-status.com.
2. If the latest deploy broke it, promote the previous deployment (Deployments › ⋯ › Promote).

**"… answered HTTP 401", "HTTP 307" or other 3xx.** The production URL is behind a login. Check Vercel › Settings › Deployment Protection; production domains must stay public.

**"The app is up but can't reach its database."**
1. Check the Supabase dashboard; a paused free project needs **Restore**.
2. Check status.supabase.com.
3. Check `DATABASE_URL` in Vercel.

`/api/health/ready` returns 503 the whole time.

**"… has no usable DATABASE_URL."** Set `DATABASE_URL` in Vercel's Production environment (`docs/deployment.md`) and redeploy.

**"The nightly job "…" failed on its last run."**
1. Read its `error` in `job_runs`, and the Vercel logs for `/api/cron/daily` around 22:00 UTC.
2. Fix the cause.
3. Run the jobs again with **Run** in Vercel › Settings › Cron Jobs.

An error naming `POLYGON_API_KEY` means the key is missing in Vercel: add it, then redeploy, because a variable only reaches new deployments. `plaid` is different. It skips and succeeds without Plaid's keys, because Plaid is optional, so it never shows here.

**"The nightly job "…" has never succeeded" or "hasn't succeeded since …".** Usually every nightly job is late together, because nothing called `/api/cron/daily`.
1. Check `CRON_SECRET` in Vercel. Without it the route answers 503 `CRON_NOT_CONFIGURED`.
2. Check the cron's logs in Vercel › Settings › Cron Jobs.
3. Run the jobs by hand from there.

A single late job means the run was cut off before it. `alpha-radar` has a route of its own (`/api/cron/alpha-radar`, around 11:00 UTC): read its `error` in `job_runs`; "SEC_EDGAR_USER_AGENT is not set" means the variable is missing in Vercel, and "Every filer checked failed" usually means SEC refused the requests (its fair-access rules) or was down. A newly deployed job is late until its first scheduled run.

**"The nightly backup failed on its last run."**
1. Open the run: Actions › Database backup, or `detail ->> 'runUrl'` in `job_runs`.
2. The usual cause is a missing `BACKUP_AGE_RECIPIENTS` (`docs/backups.md`).
3. Fix it and use **Run workflow** on master.

**"The nightly backup has never succeeded" or "hasn't succeeded since …".** The backup didn't run.
1. In Actions › Database backup, re-enable the workflow if GitHub disabled it. In a public repository GitHub turns off schedules after 60 days without a commit, and it can skip a scheduled run under load.
2. Use **Run workflow** on master.

A backup that ran but couldn't record itself (the database was down at the end) also shows as late, and its run is red.

**"The newest stored closing prices are from …" or "No closing prices are stored".** The price job hasn't stored a new day in two runs.
1. If `prices` is also failed, start there: its error says why (`POLYGON_API_KEY` missing, say).
2. Otherwise read the latest `prices` runs' `detail` in `job_runs`. `stopped.catchUp` says why each run stopped before storing a day: `rate-limited` or `budget` (Massive's limit, or a long history backfill using up the run; it catches up five days a run), or `not-published` (Massive hadn't published the day's file). `days` lists the days it stored.
3. Check Massive's status page, and that the key's plan still allows grouped daily bars.
4. Run the jobs again with **Run** in Vercel › Settings › Cron Jobs once the cause is fixed. Until then, everything valued at a close uses the last one stored.

**"The portfolio snapshots were last brought up to …" or "No snapshots run has valued the portfolios yet".** Two `snapshots` runs valued nothing.
1. If the closes are stale too, start there: snapshots are valued at stored closes, and catch up on the first run after prices do.
2. Otherwise read the latest `snapshots` runs' `detail` in `job_runs`. A `skipped` reason about the holdings split check means the `prices` run didn't check held positions against splits through the newest close: its `holdingSplits.skipped` says why (`rate-limited`, `budget`, or the error from Massive's splits endpoint).
3. Once a `prices` run checks them, the next `snapshots` run fills in the missed days from stored closes. Run the jobs again with **Run** in Vercel › Settings › Cron Jobs to do it now.

**"…/api/health/jobs answered HTTP 404" (or something it can't read).** The deployment is older than this check, or the route is failing. See the Vercel logs.

## When the monitor itself stops

The monitor is a scheduled workflow too, so the 60-day rule applies to it. GitHub emails before it disables a schedule. Re-enable it under Actions › Production monitor.

For a check that doesn't depend on GitHub, add two monitors in a free uptime service, such as UptimeRobot or Better Stack. Alert on any answer other than 2xx:
- `https://atlas-wealth-lovat.vercel.app/api/health/ready`
- `https://atlas-wealth-lovat.vercel.app/api/health/jobs`

The second answers 503 whenever a job or the backup is late or failed, or the closes or snapshots are stale, so it covers them as well.

## Running it yourself

Run one check now from Actions › Production monitor › **Run workflow**. To check without touching the issue:

```bash
node --input-type=module -e "import { checkProduction } from './scripts/monitor/production-check.mts'; console.log(await checkProduction('https://atlas-wealth-lovat.vercel.app', { attempts: 1 }))"
```

An empty list means every check passes.
