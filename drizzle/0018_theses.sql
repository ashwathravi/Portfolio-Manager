CREATE TABLE "theses" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"ticker" text NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"conviction" text NOT NULL,
	"target_price" double precision NOT NULL,
	"current_price" double precision,
	"time_horizon" text DEFAULT '' NOT NULL,
	"date_created" date NOT NULL,
	"date_updated" date NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hypothesis" text DEFAULT '' NOT NULL,
	"bull_case" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bear_case" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"health_score" integer DEFAULT 50 NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"write_session" text,
	"write_seq" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "theses_pkey" PRIMARY KEY("user_id","id"),
	CONSTRAINT "theses_type_check" CHECK ("theses"."type" in ('bull', 'bear')),
	CONSTRAINT "theses_status_check" CHECK ("theses"."status" in ('active', 'monitoring', 'archived')),
	CONSTRAINT "theses_conviction_check" CHECK ("theses"."conviction" in ('HIGH', 'MEDIUM', 'LOW'))
);
--> statement-breakpoint
ALTER TABLE "theses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "thesis_catalysts" (
	"user_id" text NOT NULL,
	"thesis_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"date" text DEFAULT '' NOT NULL,
	"impact" text NOT NULL,
	CONSTRAINT "thesis_catalysts_pkey" PRIMARY KEY("user_id","thesis_id","id"),
	CONSTRAINT "thesis_catalysts_impact_check" CHECK ("thesis_catalysts"."impact" in ('high', 'medium', 'low'))
);
--> statement-breakpoint
ALTER TABLE "thesis_catalysts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "thesis_evidence" (
	"user_id" text NOT NULL,
	"thesis_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"date" text DEFAULT '' NOT NULL,
	"url" text,
	CONSTRAINT "thesis_evidence_pkey" PRIMARY KEY("user_id","thesis_id","id"),
	CONSTRAINT "thesis_evidence_type_check" CHECK ("thesis_evidence"."type" in ('article', 'report', 'earnings', 'note'))
);
--> statement-breakpoint
ALTER TABLE "thesis_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_catalysts" ADD CONSTRAINT "thesis_catalysts_thesis_fk" FOREIGN KEY ("user_id","thesis_id") REFERENCES "public"."theses"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thesis_evidence" ADD CONSTRAINT "thesis_evidence_thesis_fk" FOREIGN KEY ("user_id","thesis_id") REFERENCES "public"."theses"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "theses" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "theses" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "thesis_catalysts" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "thesis_catalysts" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "thesis_evidence" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "thesis_evidence" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);