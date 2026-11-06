CREATE TABLE "alert_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"occurrence" text NOT NULL,
	"rule_name" text NOT NULL,
	"metric" text NOT NULL,
	"symbol" text,
	"comparator" text NOT NULL,
	"threshold" double precision NOT NULL,
	"observed_value" double precision NOT NULL,
	"message" text NOT NULL,
	"href" text,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp,
	"cleared" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"metric" text NOT NULL,
	"symbol" text,
	"comparator" text NOT NULL,
	"threshold" double precision NOT NULL,
	"rearm" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text,
	"last_triggered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "alert_rules_metric_check" CHECK ("alert_rules"."metric" in ('price', 'price_change_pct', 'portfolio_value', 'portfolio_day_change_pct', 'alpha_radar_new_position', 'alpha_radar_exit', 'alpha_radar_large_add', 'alpha_radar_large_trim', 'alpha_radar_user_overlap')),
	CONSTRAINT "alert_rules_symbol_check" CHECK (("alert_rules"."metric" in ('price', 'price_change_pct')) = ("alert_rules"."symbol" is not null)),
	CONSTRAINT "alert_rules_comparator_check" CHECK ("alert_rules"."comparator" in ('gte', 'lte', 'gt', 'lt', 'eq')),
	CONSTRAINT "alert_rules_rearm_check" CHECK ("alert_rules"."rearm" in ('once', 'always', 'daily'))
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_rule_owner_fk" FOREIGN KEY ("rule_id","user_id") REFERENCES "public"."alert_rules"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_notifications_user_triggered_idx" ON "alert_notifications" USING btree ("user_id","triggered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_notifications_rule_occurrence_idx" ON "alert_notifications" USING btree ("rule_id","occurrence");--> statement-breakpoint
CREATE INDEX "alert_rules_user_created_idx" ON "alert_rules" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "alert_notifications" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "alert_notifications" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "alert_rules" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "alert_rules" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);