# Database credentials

The Supabase project is production. Local development and E2E use the Postgres container in `docker-compose.yml` and never connect to Supabase.

## Two roles in every environment

| Variable | Role | Used by |
|---|---|---|
| `DATABASE_URL` | A login role that is a member of `app_runtime` (migration 0010): read/write on app tables, no DDL, not the table owner, so RLS applies | The app |
| `DATABASE_MIGRATION_URL` | The table owner | `npm run db:migrate`, `db:setup`, the deploy pipeline |

`app_runtime` itself cannot log in. Each environment creates its own login role as a member, so no password lives in a migration.

## Local development

No secrets. `.env.example` holds local-only passwords for the Docker database:

```bash
cp .env.example .env.local
npm run db:up      # Postgres on 127.0.0.1:54329
npm run db:setup   # migrate, create atlas_app and the local dev user, seed examples
```

`db:setup` refuses to run unless both URLs point at localhost.

## Production (Supabase)

After migration 0010 has been applied, create the app's login role once in the Supabase SQL editor, with a generated password of 32+ characters:

```sql
CREATE ROLE atlas_app LOGIN PASSWORD '<generated password>';
GRANT app_runtime TO atlas_app;
```

Then build both connection strings from the hosts shown under Supabase › Connect:

- `DATABASE_URL`: transaction pooler (port 6543), user `atlas_app.<project-ref>`
- `DATABASE_MIGRATION_URL`: session pooler (port 5432), user `postgres.<project-ref>`

Store them in Vercel project environment variables (production) and GitHub Actions secrets (migrations). They do not belong in any file in this repository or in `.env.local`.

## Keychain helpers

The macOS login Keychain can hold a production connection string for one-off operations and for copying it to GitHub without it touching a file or shell history:

```bash
npm run keychain:store          # prompts for the value
npm run keychain:sync-github    # copies it to the DATABASE_URL repository secret
bash scripts/with-keychain-env.sh <command>   # runs one command with DATABASE_URL from Keychain
```

The default Keychain service is `atlas-wealth/DATABASE_URL`, with the current macOS user as the account. To use a different item, set `ATLAS_WEALTH_KEYCHAIN_SERVICE` and/or `ATLAS_WEALTH_KEYCHAIN_ACCOUNT` consistently for every command. For a GitHub Actions environment secret, also set `GITHUB_ENVIRONMENT`, for example `GITHUB_ENVIRONMENT=staging npm run keychain:sync-github`.

The old `dev:keychain` and `start:keychain` scripts were removed because they ran the local app against production.

Neither helper prints the connection string or writes it to a file. Rotate the Supabase database password if the credential may have been exposed.
