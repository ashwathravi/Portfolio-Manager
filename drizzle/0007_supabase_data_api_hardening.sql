ALTER TABLE "alpha_radar_filing_holdings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alpha_radar_holding_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alpha_radar_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alpha_radar_sec_filings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alpha_radar_semantic_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alpha_radar_tracked_filers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_authenticators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_verification_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "holdings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plaid_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plaid_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE USAGE ON SCHEMA public FROM anon;
		REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
		REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
		ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
		ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
	END IF;

	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		REVOKE USAGE ON SCHEMA public FROM authenticated;
		REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM authenticated;
		REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
		ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
		ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
		REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
			REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon;
		END IF;
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
			REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated;
		END IF;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
		CREATE SCHEMA IF NOT EXISTS extensions;
		ALTER EXTENSION vector SET SCHEMA extensions;
	END IF;
END $$;
