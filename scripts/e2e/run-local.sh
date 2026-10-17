#!/usr/bin/env bash
# Runs the E2E suite locally against a fresh database in the Docker Postgres
# container, with database sessions like CI. Extra arguments go to Playwright,
# e.g. `npm run test:e2e:local -- tests/e2e/holdings.spec.ts`.
#
# Every checkout, git worktrees included, shares that container, its
# atlas_wealth_e2e database and ports 3000 and 3100, so runs take turns: this
# one waits up to E2E_LOCK_WAIT_SECONDS (default 1800) for another to finish.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

if [[ "${E2E_LOCAL_RUN_LOCKED:-}" != "1" ]]; then
    # Start the container if it isn't running, but never recreate it: that
    # would restart Postgres under another checkout's dev server or E2E run.
    # `npm run db:up` applies changes to docker-compose.yml.
    bash scripts/db/check-container-project.sh
    docker compose up -d --wait --no-recreate db >/dev/null

    # Run the rest of this script while holding the lock (scripts/e2e/run-lock.mjs).
    export E2E_LOCAL_RUN_LOCKED=1
    export E2E_LOCK_DATABASE_URL="postgres://atlas:atlas-local-only@127.0.0.1:54329/postgres"
    exec node scripts/e2e/run-lock.mjs bash "$repository_root/scripts/e2e/run-local.sh" "$@"
fi

# Playwright reuses a server already on port 3000, and that server may be
# connected to another database. Refuse rather than test against it, and
# refuse when the check itself can't tell. Checked under the lock: while
# another run holds it, that run holds these ports.
node scripts/e2e/check-port-free.mjs 3000
node scripts/e2e/check-port-free.mjs 3100

docker compose exec -T db psql -U atlas -d postgres --set=ON_ERROR_STOP=1 --quiet \
    -c 'DROP DATABASE IF EXISTS atlas_wealth_e2e WITH (FORCE);' \
    -c 'CREATE DATABASE atlas_wealth_e2e;'

export ADMIN_DATABASE_URL="postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth_e2e"
export APP_DATABASE_URL="postgres://atlas_app_e2e:atlas-app-e2e-local-only@127.0.0.1:54329/atlas_wealth_e2e"
node --import tsx scripts/e2e/prepare-database.ts

DATABASE_URL="$APP_DATABASE_URL" E2E_DATABASE_AUTH=1 npx playwright test "$@"
