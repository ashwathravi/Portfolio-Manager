CREATE TABLE "portfolio_snapshot_positions" (
	"portfolio_id" uuid NOT NULL,
	"date" date NOT NULL,
	"symbol" text NOT NULL,
	"quantity" numeric NOT NULL,
	"cost_basis" double precision NOT NULL,
	"close" double precision,
	"close_date" date,
	"market_value" double precision,
	CONSTRAINT "portfolio_snapshot_positions_portfolio_id_date_symbol_pk" PRIMARY KEY("portfolio_id","date","symbol")
);
--> statement-breakpoint
ALTER TABLE "portfolio_snapshot_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"portfolio_id" uuid NOT NULL,
	"date" date NOT NULL,
	"holdings_value" double precision NOT NULL,
	"cash" double precision NOT NULL,
	"total_value" double precision NOT NULL,
	"cost_basis" double precision NOT NULL,
	"positions" integer NOT NULL,
	"unpriced" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_snapshots_portfolio_id_date_pk" PRIMARY KEY("portfolio_id","date")
);
--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_snapshot_positions" ADD CONSTRAINT "portfolio_snapshot_positions_snapshot_fk" FOREIGN KEY ("portfolio_id","date") REFERENCES "public"."portfolio_snapshots"("portfolio_id","date") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_date_idx" ON "portfolio_snapshots" USING btree ("date");--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "portfolio_snapshot_positions" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "portfolio_snapshot_positions" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "portfolio_snapshots" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "portfolio_snapshots" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);