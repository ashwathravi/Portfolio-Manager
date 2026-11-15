CREATE TABLE "intraday_quotes" (
	"symbol" text PRIMARY KEY NOT NULL,
	"price" double precision,
	"previous_close" double precision,
	"quoted_at" timestamp,
	"claimed_at" timestamp NOT NULL,
	"fetched_at" timestamp,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intraday_quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intraday_quotes" ADD CONSTRAINT "intraday_quotes_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "intraday_quotes_claimed_at_idx" ON "intraday_quotes" USING btree ("claimed_at");--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "intraday_quotes" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "intraday_quotes" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);