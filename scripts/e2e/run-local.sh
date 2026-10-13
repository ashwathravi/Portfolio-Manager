#!/usr/bin/env bash
# Runs the E2E suite locally against a fresh database in the Docker Postgres
# container, with database sessions like CI. Extra arguments go to Playwright,
# e.g. `npm run test:e2e:local -- tests/e2e/holdings.spec.ts`.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repository_root"

# Playwright reuses a server already on port 3000, and that server may be
# connected to another database. Refuse rather than test against it.
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 3000 is in use. Stop your dev server first; Playwright would reuse it." >&2
    exit 1
fi

docker compose up -d --wait db >/dev/null
docker compose exec -T db psql -U atlas -d postgres --set=ON_ERROR_STOP=1 --quiet \
    -c 'DROP DATABASE IF EXISTS atlas_wealth_e2e WITH (FORCE);' \
    -c 'CREATE DATABASE atlas_wealth_e2e;'

export ADMIN_DATABASE_URL="postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth_e2e"
export APP_DATABASE_URL="postgres://atlas_app_e2e:atlas-app-e2e-local-only@127.0.0.1:54329/atlas_wealth_e2e"
node --import tsx scripts/e2e/prepare-database.ts

DATABASE_URL="$APP_DATABASE_URL" E2E_DATABASE_AUTH=1 npx playwright test "$@"
