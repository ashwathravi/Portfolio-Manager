CREATE TABLE "watchlist_items" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"ticker" text NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"target_entry" double precision,
	"added_at" date NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_items_pkey" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "watchlist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_items_user_ticker_idx" ON "watchlist_items" USING btree ("user_id","ticker") WHERE not "watchlist_items"."dismissed";--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "watchlist_items" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "watchlist_items" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);