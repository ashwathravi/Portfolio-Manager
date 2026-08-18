#!/usr/bin/env bash
# Idempotent repository bootstrap for the Atlas Wealth Cloud Agent environment.
# Runs after the repository is checked out. Prepares Node dependencies, a local
# PostgreSQL cluster, database schema (migrations), seed data, and the Playwright
# browser used by the E2E suite. Safe to run repeatedly.

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=.cursor/lib.sh
source ".cursor/lib.sh"

echo "==> Ensuring PostgreSQL is installed"
# Normally provided by the environment's base image/snapshot. Install it here as
# a fallback so this script also bootstraps a plain base image. Idempotent.
if [ -z "${PG_BIN:-}" ]; then
    if command -v sudo >/dev/null 2>&1; then
        sudo apt-get update -qq
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-client
        # The apt package auto-creates a "main" cluster on port 5432; drop it so
        # our user-owned cluster owns the port.
        sudo pg_dropcluster --stop 16 main 2>/dev/null || true
    else
        echo "ERROR: PostgreSQL is not installed and sudo is unavailable." >&2
        exit 1
    fi
    refresh_pg_path
fi

echo "==> Installing Node dependencies (npm ci)"
npm ci

echo "==> Ensuring local PostgreSQL cluster exists at $PGDATA"
if [ ! -s "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA"
    # Trust auth for a local, throwaway dev database (no secrets involved).
    initdb -D "$PGDATA" -U "$PGUSER_APP" --auth-local=trust --auth-host=trust --encoding=UTF8 >/dev/null
fi

echo "==> Starting PostgreSQL"
start_postgres
wait_for_postgres

echo "==> Ensuring Supabase-compatible roles exist (anon, authenticated)"
# RLS policies in the migrations target these roles, mirroring Supabase.
psql -h "$PGHOST" -p "$PGPORT" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
SQL

echo "==> Ensuring application database exists ($PGDATABASE_APP)"
if ! psql -h "$PGHOST" -p "$PGPORT" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE_APP'" | grep -q 1; then
    createdb -h "$PGHOST" -p "$PGPORT" "$PGDATABASE_APP"
fi

echo "==> Enabling pgcrypto extension"
psql -h "$PGHOST" -p "$PGPORT" -d "$PGDATABASE_APP" -v ON_ERROR_STOP=1 \
    -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

DB_URL="postgres://${PGUSER_APP}@${PGHOST}:${PGPORT}/${PGDATABASE_APP}?sslmode=disable"

echo "==> Writing .env for local development (if missing)"
# .env is gitignored. Only local, non-secret dev values are written here.
if [ ! -f ".env" ]; then
    AUTH_SECRET_VALUE="$(openssl rand -base64 32 2>/dev/null || echo 'atlas-wealth-dev-secret-change-me')"
    cat > ".env" <<ENV
# Auto-generated for local Cloud Agent development. Do not commit real secrets.
DATABASE_URL="${DB_URL}"
# next-auth requires a secret; this is a throwaway local dev value.
AUTH_SECRET="${AUTH_SECRET_VALUE}"
ENV
else
    # Keep DATABASE_URL pointed at the local cluster even if .env already exists.
    if ! grep -q '^DATABASE_URL=' ".env"; then
        echo "DATABASE_URL=\"${DB_URL}\"" >> ".env"
    fi
fi

echo "==> Applying database migrations (drizzle-kit migrate)"
npx drizzle-kit migrate

echo "==> Seeding database with mock data"
npx tsx scripts/seed.ts

echo "==> Installing Playwright Chromium browser"
# Browser binaries for the E2E suite. System deps are provided by the base image;
# fall back to installing them with sudo when available.
if ! npx playwright install chromium; then
    echo "   Retrying Playwright install with system dependencies"
    sudo -n npx playwright install --with-deps chromium || npx playwright install --with-deps chromium
fi

echo "==> Install complete"
