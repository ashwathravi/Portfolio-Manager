CREATE TABLE "order_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_type" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"order_type" text NOT NULL,
	"quantity" numeric NOT NULL,
	"limit_price" numeric,
	"stop_price" numeric,
	"time_in_force" text NOT NULL,
	"status" text NOT NULL,
	"reference_price" double precision,
	"reference_price_date" date,
	"rationale" jsonb,
	"option_details" jsonb,
	"policy" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_plans_instrument_type_check" CHECK ("order_plans"."instrument_type" in ('equity', 'option')),
	CONSTRAINT "order_plans_side_check" CHECK ("order_plans"."side" in ('buy', 'sell')),
	CONSTRAINT "order_plans_order_type_check" CHECK ("order_plans"."order_type" in ('market', 'limit', 'stop', 'stop_limit')),
	CONSTRAINT "order_plans_time_in_force_check" CHECK ("order_plans"."time_in_force" in ('day', 'gtc', 'ioc', 'fok')),
	CONSTRAINT "order_plans_status_check" CHECK ("order_plans"."status" in ('pending_approval', 'ready', 'placed', 'cancelled')),
	CONSTRAINT "order_plans_quantity_check" CHECK ("order_plans"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "order_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_plans" ADD CONSTRAINT "order_plans_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_plans" ADD CONSTRAINT "order_plans_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_plans_user_created_idx" ON "order_plans" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "order_plans_portfolio_id_idx" ON "order_plans" USING btree ("portfolio_id");--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "order_plans" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "order_plans" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);