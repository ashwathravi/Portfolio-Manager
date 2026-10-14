CREATE TABLE "price_bars" (
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "price_bars_symbol_date_pk" PRIMARY KEY("symbol","date")
);
--> statement-breakpoint
ALTER TABLE "price_bars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "securities" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text,
	"type" text,
	"primary_exchange" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sector" text,
	"industry" text,
	"reference_updated_at" timestamp,
	"history_start_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "securities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_bars" ADD CONSTRAINT "price_bars_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "price_bars_date_idx" ON "price_bars" USING btree ("date");--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "price_bars" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "price_bars" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "securities" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "securities" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);