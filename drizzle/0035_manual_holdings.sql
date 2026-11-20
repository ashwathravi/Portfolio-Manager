CREATE TABLE "manual_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"identifier" text,
	"quantity" numeric,
	"value" numeric NOT NULL,
	"cost_basis" numeric,
	"value_as_of" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manual_holdings_name_check" CHECK (char_length("manual_holdings"."name") between 1 and 120),
	CONSTRAINT "manual_holdings_identifier_check" CHECK ("manual_holdings"."identifier" is null or char_length("manual_holdings"."identifier") between 1 and 40),
	CONSTRAINT "manual_holdings_value_check" CHECK ("manual_holdings"."value" >= 0),
	CONSTRAINT "manual_holdings_quantity_check" CHECK ("manual_holdings"."quantity" is null or "manual_holdings"."quantity" > 0),
	CONSTRAINT "manual_holdings_cost_basis_check" CHECK ("manual_holdings"."cost_basis" is null or "manual_holdings"."cost_basis" >= 0),
	CONSTRAINT "manual_holdings_source_check" CHECK ("manual_holdings"."source" in ('manual', 'plaid'))
);
--> statement-breakpoint
ALTER TABLE "manual_holdings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manual_holdings" ADD CONSTRAINT "manual_holdings_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_holdings" ADD CONSTRAINT "manual_holdings_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","user_id") REFERENCES "public"."portfolios"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_holdings_user_id_idx" ON "manual_holdings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "manual_holdings_portfolio_id_idx" ON "manual_holdings" USING btree ("portfolio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_holdings_portfolio_external_idx" ON "manual_holdings" USING btree ("portfolio_id","external_id") WHERE "manual_holdings"."external_id" is not null;--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "manual_holdings" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "manual_holdings" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);