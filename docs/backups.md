# Backups

Production's database is backed up every night by `.github/workflows/database-backup.yml` (launch item i68). Each backup is restored into a scratch database in the same run and checked table by table, so a backup that wouldn't restore fails the run that made it.

| | |
|---|---|
| **When** | 06:41 UTC every day (GitHub may start it late), and on demand: `gh workflow run database-backup.yml` |
| **What** | Every table in the `public` schema, read in one snapshot, plus the migrations applied |
| **Where** | A GitHub Actions artifact, `atlas-wealth-backup-<date>`, kept for 30 days |
| **Who can read it** | Only someone with the backup key. The repository is public, so anyone can download the artifact, but it is encrypted with [age](https://age-encryption.org) to the key's public half; CI can encrypt and never decrypt |

The Supabase Free plan has no backups you can download and no point-in-time recovery, so these are the only copy. Pro adds 7 days of daily backups, and point-in-time recovery is a paid add-on on top of Pro ([Supabase › Database backups](https://supabase.com/docs/guides/platform/backups)). Keep the nightly backups after upgrading: they live outside Supabase and are proven to restore every night.

## What a backup holds

The encrypted file is a tar archive of:

| File | What it is |
|---|---|
| `data.dump` | `pg_dump --data-only` of `public` (custom format). A restore loads this; `pg_dump` orders the tables so foreign keys hold as it goes. |
| `schema.dump` | `pg_dump --schema-only` of `public` and `drizzle`: the schema as production really had it, grants and policies included. A restore doesn't use it (the migrations rebuild the schema); it's there in case the two ever differ. |
| `manifest.json` | When it was made, the commit that made it, the server and `pg_dump` versions, every migration applied (hash and timestamp), every table's exact row count, and both dumps' SHA-256. |

That covers everything the app stores: accounts, holdings, transactions, order plans, theses, the journal, the watchlist, settings, Ask conversations, Plaid connections, Auth.js users and sessions, prices, valuation snapshots, Alpha Radar and `job_runs`.

Not in a backup:

- **Database roles and their passwords**, such as the app's `atlas_app` login. A recovery creates it again.
- **Secrets**: Vercel's environment variables and GitHub's secrets. Two of them are needed to use restored data: `PLAID_TOKEN_ENCRYPTION_KEY` (the Plaid access tokens are encrypted with it) and `AUTH_SECRET`.
- **Upstash Redis**: rate limits and caches only, rebuilt as the app runs.

## How a night's run works

1. **Dump** (`scripts/db/backup.ts`, as the table owner through the `production` environment's `DATABASE_MIGRATION_URL`; GitHub lists each run as a deployment to `production`). One read-only, repeatable-read transaction exports its snapshot, counts every table in it, and both `pg_dump`s run on that snapshot. The counts are therefore exactly what the dumps hold, while the app keeps writing.
2. **Encrypt** the three files to every public key in the repository variable `BACKUP_AGE_RECIPIENTS`, then upload the result as the artifact.
3. **Restore** (`scripts/db/restore.ts`) into a scratch Postgres 17 in the same job. It rebuilds the schema with this checkout's migrations, exactly the ones the backup had applied, then loads the data in one transaction with foreign keys checked. Finally it compares every table's rows and the migrations with the manifest. The run fails on any difference; the backup from step 2 is kept either way.

The logs show totals only (tables, rows, migrations), never a table's rows: they're public.

**When a run fails**, GitHub emails whoever last changed the workflow's schedule. Check that github.com › Settings › Notifications › Actions has failed workflows turned on. GitHub can also start a scheduled run late or skip it under load, and in a public repository it turns schedules off after 60 days without activity. An alert for a run that didn't happen is launch item i71.

A pull request that changes the backup scripts, the migrations or the workflow runs the same steps against the E2E fixtures, with a throwaway key: dump, encrypt, decrypt, restore and check.

## One-time setup: the backup key

Make the key on your Mac and give GitHub only its public half:

```bash
brew install age
age-keygen -o ~/Desktop/atlas-wealth-backup.agekey
gh variable set BACKUP_AGE_RECIPIENTS --repo ashwathravi/Portfolio-Manager --body "$(age-keygen -y ~/Desktop/atlas-wealth-backup.agekey)"
```

Save `atlas-wealth-backup.agekey` in 1Password (a Document item, "Atlas Wealth backup key"), then delete it from the Desktop:

```bash
rm ~/Desktop/atlas-wealth-backup.agekey
```

Without this key nobody can decrypt any backup, you included, so keep it somewhere that doesn't depend on this Mac. To add a second key, such as a copy kept offline, put one public key per line in the variable. To replace the key, set the variable to the new public key; backups made before then still need the old key until they expire.

Then make the first backup and watch it:

```bash
gh workflow run database-backup.yml --repo ashwathravi/Portfolio-Manager
gh run watch --repo ashwathravi/Portfolio-Manager
```

## The restore drill

Do this once after setup and then every quarter. It proves the key works and the steps below are right. It needs this repository checked out, the local Docker database (`npm run db:up`), `age`, and `gh`.

1. Download the latest backup:

   ```bash
   mkdir -p ~/atlas-restore && cd ~/atlas-restore
   gh run list --repo ashwathravi/Portfolio-Manager --workflow database-backup.yml --status success --limit 3
   gh run download <run id> --repo ashwathravi/Portfolio-Manager --dir .
   ```

2. Decrypt it with the key from 1Password (save the document to a file first):

   ```bash
   mkdir backup
   age --decrypt --identity /path/to/atlas-wealth-backup.agekey atlas-wealth-backup-*/atlas-wealth-backup-*.tar.age | tar -C backup -xf -
   ```

3. Restore it into a new database in the local container, from the repository's directory:

   ```bash
   docker exec atlas-wealth-db createdb -U atlas atlas_wealth_restore
   RESTORE_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth_restore npm run db:restore -- --from ~/atlas-restore/backup
   ```

   It ends with `✅ Restored the backup from <time>: … Every table matches.` If it says the checkout lacks a migration, check out the commit it names (the manifest's `commit`) and run it again from there.

4. This is production data on your Mac. Look at what you need, then delete it:

   ```bash
   docker exec atlas-wealth-db dropdb -U atlas atlas_wealth_restore
   rm -rf ~/atlas-restore
   ```

Note the date of the drill in the launch tracker.

## Recovering production

Use this when production's data is lost or damaged (a bad migration, a mistaken delete) or the Supabase project is gone. Anything written after the backup you restore is lost, up to a day.

1. **Pick the backup**: the newest successful run from before the damage (`gh run list` as in the drill).
2. **Make a new, empty database**: a new Supabase project in the same region. Don't restore over the damaged database: the restore refuses one that already has tables, and the old one is what you'd investigate.
3. **Download and decrypt** as in the drill.
4. **Restore** into the new project as its owner, through the session pooler (Supabase › Connect: port 5432, user `postgres.<project-ref>`, ending in `?sslmode=require`). `read -rs` keeps the password out of your shell history:

   ```bash
   read -rs RESTORE_DATABASE_URL && export RESTORE_DATABASE_URL
   npm run db:restore -- --from ~/atlas-restore/backup
   unset RESTORE_DATABASE_URL
   ```

5. **Create the app's login** in the new project's SQL editor, with a new generated password (see `docs/local-database-secrets.md`):

   ```sql
   CREATE ROLE atlas_app LOGIN PASSWORD '<generated password>';
   GRANT app_runtime TO atlas_app;
   ```

6. **Point production at it**:
   - In Vercel, set `DATABASE_URL` to the transaction pooler (port 6543) as `atlas_app.<project-ref>`.
   - In GitHub, set `gh secret set DATABASE_MIGRATION_URL --env production`.
   - Leave `PLAID_TOKEN_ENCRYPTION_KEY` and `AUTH_SECRET` as they are.
   - Re-run the latest `deploy-production` job on master. It applies any migrations newer than the backup, deploys, and waits for `/api/health/ready`.
7. **Afterwards**: the nightly job brings prices back up to date, and a Plaid sync fetches what the linked accounts did since the backup. Changes users made by hand after the backup are gone; tell them which day they're back to.

## Running the scripts yourself

```bash
BACKUP_SOURCE_URL=postgres://… npm run db:backup -- --out <new directory>
RESTORE_DATABASE_URL=postgres://… npm run db:restore -- --from <backup directory>
```

Neither reads `.env.local`: the source and target are always given explicitly. They need `pg_dump` and `pg_restore` at least as new as the server: `brew install libpq` (found without changing the `PATH`), or set `PG_BIN_DIR`. Their tests:

- `scripts/db/backups.test.ts` runs with `npm test`.
- `scripts/db/backup-restore.test.ts` needs a database: `SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth npm test`.
