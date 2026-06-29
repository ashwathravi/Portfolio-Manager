DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
		CREATE EXTENSION IF NOT EXISTS vector;
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "alpha_radar_semantic_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"tracked_filer_id" uuid,
	"filing_id" uuid,
	"report_id" uuid,
	"report_period" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"citation" jsonb NOT NULL,
	"metadata" jsonb,
	"keywords" jsonb NOT NULL,
	"embedding" jsonb,
	"embedding_provider" text,
	"embedding_model" text,
	"embedding_dimensions" integer,
	"content_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alpha_radar_semantic_chunks" ADD CONSTRAINT "alpha_radar_semantic_chunks_tracked_filer_id_alpha_radar_tracked_filers_id_fk" FOREIGN KEY ("tracked_filer_id") REFERENCES "public"."alpha_radar_tracked_filers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "alpha_radar_semantic_chunks" ADD CONSTRAINT "alpha_radar_semantic_chunks_filing_id_alpha_radar_sec_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."alpha_radar_sec_filings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "alpha_radar_semantic_chunks" ADD CONSTRAINT "alpha_radar_semantic_chunks_report_id_alpha_radar_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."alpha_radar_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "alpha_radar_semantic_chunks_source_idx" ON "alpha_radar_semantic_chunks" USING btree ("source_kind","source_id");
--> statement-breakpoint
CREATE INDEX "alpha_radar_semantic_chunks_tracked_filer_period_idx" ON "alpha_radar_semantic_chunks" USING btree ("tracked_filer_id","report_period");
--> statement-breakpoint
CREATE INDEX "alpha_radar_semantic_chunks_report_idx" ON "alpha_radar_semantic_chunks" USING btree ("report_id");
--> statement-breakpoint
CREATE INDEX "alpha_radar_semantic_chunks_filing_idx" ON "alpha_radar_semantic_chunks" USING btree ("filing_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_radar_semantic_chunks_source_chunk_idx" ON "alpha_radar_semantic_chunks" USING btree ("source_kind","source_id","chunk_index");
--> statement-breakpoint
CREATE INDEX "alpha_radar_semantic_chunks_keywords_gin_idx" ON "alpha_radar_semantic_chunks" USING gin ("keywords");
--> statement-breakpoint
CREATE INDEX "alpha_radar_semantic_chunks_metadata_gin_idx" ON "alpha_radar_semantic_chunks" USING gin ("metadata");
