-- Least-privilege runtime role. The app connects as a LOGIN role that is a
-- member of app_runtime, created per environment outside migrations so no
-- password lives in the repository (see docs/local-database-secrets.md).
-- It is not the table owner, so RLS applies to it; the policies below are
-- what let it read and write. Migrations keep running as the table owner.
DO $$
BEGIN
	CREATE ROLE app_runtime NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
	NULL;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "alpha_radar_filing_holdings" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "alpha_radar_holding_changes" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "alpha_radar_reports" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "alpha_radar_sec_filings" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "alpha_radar_semantic_chunks" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "alpha_radar_tracked_filers" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "auth_accounts" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "auth_authenticators" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "auth_sessions" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "auth_users" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "auth_verification_tokens" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "holdings" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "plaid_accounts" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "plaid_items" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "portfolios" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "transactions" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);