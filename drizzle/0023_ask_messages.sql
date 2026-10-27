CREATE TABLE "ask_messages" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_runs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cleared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ask_messages_pkey" PRIMARY KEY("user_id","id"),
	CONSTRAINT "ask_messages_role_check" CHECK ("ask_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
ALTER TABLE "ask_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_messages_user_created_at_idx" ON "ask_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "ask_messages" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "ask_messages" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);