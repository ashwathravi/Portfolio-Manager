CREATE TABLE "journal_entries" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"ticker" text NOT NULL,
	"decision" text NOT NULL,
	"rationale" text NOT NULL,
	"outcome" text NOT NULL,
	"thesis_id" text,
	"dismissed" boolean DEFAULT false NOT NULL,
	"write_session" text,
	"write_seq" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_pkey" PRIMARY KEY("user_id","id"),
	CONSTRAINT "journal_entries_type_check" CHECK ("journal_entries"."type" in ('entry', 'exit', 'hold')),
	CONSTRAINT "journal_entries_outcome_check" CHECK ("journal_entries"."outcome" in ('win', 'loss', 'pending'))
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "journal_entries" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "journal_entries" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);