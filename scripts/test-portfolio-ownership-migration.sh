#!/usr/bin/env bash

set -euo pipefail

if [[ "${CI:-}" != "true" ]]; then
    echo "This destructive database fixture is restricted to the disposable CI PostgreSQL service." >&2
    exit 1
fi

if [[ -z "${PG_TEST_ADMIN_URL:-}" ]]; then
    echo "PG_TEST_ADMIN_URL must point to the disposable CI PostgreSQL admin database." >&2
    exit 1
fi

case "$PG_TEST_ADMIN_URL" in
    postgres://postgres:postgres@localhost:5432/*|postgresql://postgres:postgres@localhost:5432/*)
        ;;
    *)
        echo "Refusing to create migration fixtures outside the expected loopback CI PostgreSQL service." >&2
        exit 1
        ;;
esac

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"
valid_database="atlas_wealth_migration_valid"
invalid_database="atlas_wealth_migration_invalid"
valid_url="postgres://postgres:postgres@localhost:5432/${valid_database}?sslmode=disable"
invalid_url="postgres://postgres:postgres@localhost:5432/${invalid_database}?sslmode=disable"

old_migrations=(
    drizzle/0000_blue_preak.sql
    drizzle/0001_damp_the_professor.sql
    drizzle/0002_ar44_sync_schema_to_drizzle.sql
    drizzle/0003_alpha_radar_domain.sql
    drizzle/0004_alpha_radar_semantic_memory.sql
    drizzle/0005_blushing_dakota_north.sql
    drizzle/0006_abnormal_overlord.sql
    drizzle/0007_supabase_data_api_hardening.sql
    drizzle/0008_server_only_rls_policies.sql
)

psql "$PG_TEST_ADMIN_URL" --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;
DO $$
BEGIN
    CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;
CREATE DATABASE atlas_wealth_migration_valid;
CREATE DATABASE atlas_wealth_migration_invalid;
SQL

apply_pre_0009_schema() {
    local database_url="$1"

    psql "$database_url" --set=ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
    for migration in "${old_migrations[@]}"; do
        psql "$database_url" --set=ON_ERROR_STOP=1 --file="$repository_root/$migration"
    done
    psql "$database_url" --set=ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA drizzle;
CREATE TABLE drizzle.__drizzle_migrations (
    id serial PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('pre-ownership-migration-fixture', 1782742151017);
SQL
}

assert_pre_0009_schema() {
    local database_url="$1"

    psql "$database_url" --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    owner_type text;
    owner_nullable text;
BEGIN
    SELECT data_type, is_nullable
    INTO owner_type, owner_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portfolios'
      AND column_name = 'user_id';

    IF owner_type <> 'uuid' OR owner_nullable <> 'YES' THEN
        RAISE EXCEPTION 'failed ownership migration changed the legacy column: type %, nullable %', owner_type, owner_nullable;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'portfolios_user_id_auth_users_id_fk'
    ) THEN
        RAISE EXCEPTION 'failed ownership migration left its foreign key behind';
    END IF;
    IF to_regclass('public.portfolios_user_id_idx') IS NOT NULL THEN
        RAISE EXCEPTION 'failed ownership migration left its owner index behind';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM drizzle.__drizzle_migrations
        WHERE created_at >= 1786683150097
    ) THEN
        RAISE EXCEPTION 'failed ownership migration was recorded as applied';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM drizzle.__drizzle_migrations
        WHERE created_at = 1782742151017
    ) THEN
        RAISE EXCEPTION 'legacy migration journal marker is missing';
    END IF;
END $$;
SQL
}

apply_pre_0009_schema "$valid_url"
apply_pre_0009_schema "$invalid_url"

psql "$valid_url" --set=ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth_users (id, name, email)
VALUES ('11111111-1111-4111-8111-111111111111', 'Migration Owner', 'migration-owner@example.test');
INSERT INTO portfolios (id, user_id, name)
VALUES (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'Legacy Portfolio'
);
INSERT INTO holdings (id, portfolio_id, symbol, name, quantity, avg_cost)
VALUES (
    '33333333-3333-4333-8333-333333333333',
    '22222222-2222-4222-8222-222222222222',
    'MIGR',
    'Migration Holding',
    1,
    10
);
INSERT INTO transactions (id, portfolio_id, timestamp, type, symbol, quantity, price, amount)
VALUES (
    '44444444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    now(),
    'BUY',
    'MIGR',
    1,
    10,
    10
);
SQL

DATABASE_URL="$valid_url" npx drizzle-kit migrate

psql "$valid_url" --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    owner_type text;
    owner_nullable text;
BEGIN
    SELECT data_type, is_nullable
    INTO owner_type, owner_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portfolios'
      AND column_name = 'user_id';

    IF owner_type <> 'text' OR owner_nullable <> 'NO' THEN
        RAISE EXCEPTION 'ownership column was not hardened: type %, nullable %', owner_type, owner_nullable;
    END IF;
    IF (SELECT count(*) FROM portfolios) <> 1
       OR (SELECT count(*) FROM holdings) <> 1
       OR (SELECT count(*) FROM transactions) <> 1 THEN
        RAISE EXCEPTION 'ownership migration did not preserve the portfolio graph';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM portfolios
        WHERE id = '22222222-2222-4222-8222-222222222222'
          AND user_id = '11111111-1111-4111-8111-111111111111'
    ) THEN
        RAISE EXCEPTION 'ownership migration did not preserve the exact portfolio owner';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM holdings
        WHERE id = '33333333-3333-4333-8333-333333333333'
          AND portfolio_id = '22222222-2222-4222-8222-222222222222'
    ) OR NOT EXISTS (
        SELECT 1 FROM transactions
        WHERE id = '44444444-4444-4444-8444-444444444444'
          AND portfolio_id = '22222222-2222-4222-8222-222222222222'
    ) THEN
        RAISE EXCEPTION 'ownership migration did not preserve exact child relationships';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'portfolios_user_id_auth_users_id_fk'
          AND confdeltype = 'r'
    ) THEN
        RAISE EXCEPTION 'restricting portfolio-owner foreign key is missing';
    END IF;
    IF to_regclass('public.portfolios_user_id_idx') IS NULL THEN
        RAISE EXCEPTION 'portfolio owner index is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM drizzle.__drizzle_migrations
        WHERE created_at = 1786683150097
    ) THEN
        RAISE EXCEPTION 'successful ownership migration was not recorded';
    END IF;

    BEGIN
        DELETE FROM auth_users WHERE id = '11111111-1111-4111-8111-111111111111';
        RAISE EXCEPTION 'owner deletion unexpectedly succeeded';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;
END $$;
SQL

psql "$invalid_url" --set=ON_ERROR_STOP=1 <<'SQL'
INSERT INTO portfolios (id, user_id, name)
VALUES ('55555555-5555-4555-8555-555555555555', NULL, 'Unowned Legacy Portfolio');
SQL

if DATABASE_URL="$invalid_url" npx drizzle-kit migrate; then
    echo "Ownership migration unexpectedly accepted an unowned portfolio." >&2
    exit 1
fi
assert_pre_0009_schema "$invalid_url"

psql "$invalid_url" --set=ON_ERROR_STOP=1 <<'SQL'
UPDATE portfolios
SET user_id = '66666666-6666-4666-8666-666666666666'
WHERE id = '55555555-5555-4555-8555-555555555555';
SQL

if DATABASE_URL="$invalid_url" npx drizzle-kit migrate; then
    echo "Ownership migration unexpectedly accepted an unmatched portfolio owner." >&2
    exit 1
fi
assert_pre_0009_schema "$invalid_url"

echo "Portfolio ownership migration upgrade-path checks passed."
