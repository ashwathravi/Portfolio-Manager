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
| `PLAID_*`, `PLAID_TOKEN_ENCRYPTION_KEY` | When account linking goes live. |

```bash
vercel env add AUTH_ALLOWED_EMAILS production
```

## Rolling back

Promote the previous deployment in the Vercel dashboard (Deployments → ⋯ → Promote) or run `vercel rollback`. This rolls back code only; a migration that already ran stays applied, which the add-first rule above makes safe.
