-- Applied before migrations by db:setup (scripts/setup-local-db.ts), db:migrate
-- (scripts/db/init-local.ts) and scripts/e2e/prepare-database.ts; safe to run again.
-- Mirrors what Supabase provides so migrations apply unchanged: the pgcrypto
-- extension and the anon/authenticated roles that migration 0008 names in
-- its deny-all policies.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
