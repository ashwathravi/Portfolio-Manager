CREATE TABLE "option_marks" (
	"contract" text PRIMARY KEY NOT NULL,
	"close" double precision,
	"close_date" date,
	"checked_session" date NOT NULL,
	"checked_at" timestamp NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "option_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "option_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"contract" text NOT NULL,
	"underlying" text NOT NULL,
	"contract_type" text NOT NULL,
	"strike" numeric NOT NULL,
	"expiry" date NOT NULL,
	"quantity" numeric NOT NULL,
	"premium" numeric NOT NULL,
	"multiplier" integer DEFAULT 100 NOT NULL,
	"opened_at" date,
	"user_mark" numeric,
	"user_mark_date" date,
	"thesis_id" text,
	"expiry_test" text DEFAULT '' NOT NULL,
	"exit_rule" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "option_positions_contract_type_check" CHECK ("option_positions"."contract_type" in ('call', 'put')),
	CONSTRAINT "option_positions_strike_check" CHECK ("option_positions"."strike" > 0),
	CONSTRAINT "option_positions_quantity_check" CHECK ("option_positions"."quantity" <> 0),
	CONSTRAINT "option_positions_premium_check" CHECK ("option_positions"."premium" >= 0),
	CONSTRAINT "option_positions_multiplier_check" CHECK ("option_positions"."multiplier" > 0),
	CONSTRAINT "option_positions_user_mark_check" CHECK (("option_positions"."user_mark" is null) = ("option_positions"."user_mark_date" is null) and ("option_positions"."user_mark" is null or "option_positions"."user_mark" >= 0)),
	CONSTRAINT "option_positions_source_check" CHECK ("option_positions"."source" in ('manual', 'csv'))
);
--> statement-breakpoint
ALTER TABLE "option_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "option_positions" ADD CONSTRAINT "option_positions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_positions" ADD CONSTRAINT "option_positions_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","user_id") REFERENCES "public"."portfolios"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "option_positions_user_id_idx" ON "option_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "option_positions_contract_idx" ON "option_positions" USING btree ("contract");--> statement-breakpoint
CREATE UNIQUE INDEX "option_positions_portfolio_contract_idx" ON "option_positions" USING btree ("portfolio_id","contract");--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "option_marks" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "option_marks" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "option_positions" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "option_positions" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);