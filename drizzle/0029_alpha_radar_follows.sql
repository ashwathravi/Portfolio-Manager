CREATE TABLE "alpha_radar_filer_follows" (
	"user_id" text NOT NULL,
	"tracked_filer_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "alpha_radar_filer_follows_pkey" PRIMARY KEY("user_id","tracked_filer_id")
);
--> statement-breakpoint
ALTER TABLE "alpha_radar_filer_follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alpha_radar_tracked_filers" ADD COLUMN "last_refreshed_at" timestamp;--> statement-breakpoint
ALTER TABLE "alpha_radar_filer_follows" ADD CONSTRAINT "alpha_radar_filer_follows_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_radar_filer_follows" ADD CONSTRAINT "alpha_radar_filer_follows_tracked_filer_id_alpha_radar_tracked_filers_id_fk" FOREIGN KEY ("tracked_filer_id") REFERENCES "public"."alpha_radar_tracked_filers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alpha_radar_filer_follows_tracked_filer_idx" ON "alpha_radar_filer_follows" USING btree ("tracked_filer_id");--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "alpha_radar_filer_follows" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "alpha_radar_filer_follows" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);