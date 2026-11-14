CREATE TABLE "email_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"alerts" boolean DEFAULT false NOT NULL,
	"weekly_review" boolean DEFAULT false NOT NULL,
	"alerts_since" timestamp,
	"weekly_review_week" text,
	"weekly_review_claimed_at" timestamp,
	"unsubscribe_token" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_preferences_unsubscribe_token_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
ALTER TABLE "email_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_notifications" ADD COLUMN "emailed_at" timestamp;--> statement-breakpoint
ALTER TABLE "alert_notifications" ADD COLUMN "email_claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "email_preferences" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "email_preferences" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);