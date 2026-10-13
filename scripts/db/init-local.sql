-- Runs once when the local Docker database is first created.
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
