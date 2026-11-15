CREATE TABLE "symbol_directory" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"exchange" text,
	"cik" text NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "symbol_directory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "symbol_directory" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "symbol_directory" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);