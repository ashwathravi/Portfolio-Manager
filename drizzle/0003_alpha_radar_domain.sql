CREATE TABLE "alpha_radar_filing_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_id" uuid NOT NULL,
	"issuer_name" text NOT NULL,
	"cusip" text NOT NULL,
	"ticker" text,
	"value_usd" numeric NOT NULL,
	"shares" numeric NOT NULL,
	"put_call" text,
	"security_type" text,
	"investment_discretion" text,
	"voting_authority_sole" numeric,
	"voting_authority_shared" numeric,
	"voting_authority_none" numeric,
	"position_rank" integer,
	"raw_holding" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alpha_radar_holding_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracked_filer_id" uuid NOT NULL,
	"current_filing_id" uuid,
	"prior_filing_id" uuid,
	"report_period" text NOT NULL,
	"change_type" text NOT NULL,
	"issuer_name" text NOT NULL,
	"cusip" text NOT NULL,
	"ticker" text,
	"current_value_usd" numeric,
	"prior_value_usd" numeric,
	"value_delta_usd" numeric,
	"current_shares" numeric,
	"prior_shares" numeric,
	"share_delta" numeric,
	"current_weight" double precision,
	"prior_weight" double precision,
	"rank_delta" integer,
	"materiality_score" double precision DEFAULT 0 NOT NULL,
	"user_relevance" jsonb,
	"display_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alpha_radar_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracked_filer_id" uuid NOT NULL,
	"filing_id" uuid,
	"report_period" text NOT NULL,
	"status" text DEFAULT 'generated' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"sections" jsonb NOT NULL,
	"markdown" text NOT NULL,
	"source_filing_ids" jsonb NOT NULL,
	"generator_version" text DEFAULT 'deterministic-v1' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alpha_radar_sec_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracked_filer_id" uuid NOT NULL,
	"cik" text NOT NULL,
	"accession_number" text NOT NULL,
	"filing_type" text NOT NULL,
	"report_period" text NOT NULL,
	"filed_at" timestamp,
	"accepted_at" timestamp,
	"primary_document_url" text,
	"information_table_url" text,
	"status" text DEFAULT 'discovered' NOT NULL,
	"raw_submission" jsonb,
	"parse_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alpha_radar_tracked_filers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"cik" text NOT NULL,
	"sec_entity_name" text,
	"manager_name" text,
	"fund_style" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alpha_radar_filing_holdings" ADD CONSTRAINT "alpha_radar_filing_holdings_filing_id_alpha_radar_sec_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."alpha_radar_sec_filings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_radar_holding_changes" ADD CONSTRAINT "alpha_radar_holding_changes_tracked_filer_id_alpha_radar_tracked_filers_id_fk" FOREIGN KEY ("tracked_filer_id") REFERENCES "public"."alpha_radar_tracked_filers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_radar_holding_changes" ADD CONSTRAINT "alpha_radar_holding_changes_current_filing_id_alpha_radar_sec_filings_id_fk" FOREIGN KEY ("current_filing_id") REFERENCES "public"."alpha_radar_sec_filings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_radar_holding_changes" ADD CONSTRAINT "alpha_radar_holding_changes_prior_filing_id_alpha_radar_sec_filings_id_fk" FOREIGN KEY ("prior_filing_id") REFERENCES "public"."alpha_radar_sec_filings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_radar_reports" ADD CONSTRAINT "alpha_radar_reports_tracked_filer_id_alpha_radar_tracked_filers_id_fk" FOREIGN KEY ("tracked_filer_id") REFERENCES "public"."alpha_radar_tracked_filers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_radar_reports" ADD CONSTRAINT "alpha_radar_reports_filing_id_alpha_radar_sec_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."alpha_radar_sec_filings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alpha_radar_sec_filings" ADD CONSTRAINT "alpha_radar_sec_filings_tracked_filer_id_alpha_radar_tracked_filers_id_fk" FOREIGN KEY ("tracked_filer_id") REFERENCES "public"."alpha_radar_tracked_filers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alpha_radar_filing_holdings_filing_idx" ON "alpha_radar_filing_holdings" USING btree ("filing_id");--> statement-breakpoint
CREATE INDEX "alpha_radar_filing_holdings_cusip_idx" ON "alpha_radar_filing_holdings" USING btree ("cusip");--> statement-breakpoint
CREATE INDEX "alpha_radar_filing_holdings_ticker_idx" ON "alpha_radar_filing_holdings" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_radar_filing_holdings_filing_cusip_idx" ON "alpha_radar_filing_holdings" USING btree ("filing_id","cusip");--> statement-breakpoint
CREATE INDEX "alpha_radar_holding_changes_tracked_filer_idx" ON "alpha_radar_holding_changes" USING btree ("tracked_filer_id");--> statement-breakpoint
CREATE INDEX "alpha_radar_holding_changes_period_idx" ON "alpha_radar_holding_changes" USING btree ("report_period");--> statement-breakpoint
CREATE INDEX "alpha_radar_holding_changes_cusip_idx" ON "alpha_radar_holding_changes" USING btree ("cusip");--> statement-breakpoint
CREATE INDEX "alpha_radar_holding_changes_ticker_idx" ON "alpha_radar_holding_changes" USING btree ("ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_radar_holding_changes_filer_period_cusip_idx" ON "alpha_radar_holding_changes" USING btree ("tracked_filer_id","report_period","cusip");--> statement-breakpoint
CREATE INDEX "alpha_radar_reports_tracked_filer_idx" ON "alpha_radar_reports" USING btree ("tracked_filer_id");--> statement-breakpoint
CREATE INDEX "alpha_radar_reports_period_idx" ON "alpha_radar_reports" USING btree ("report_period");--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_radar_reports_filer_period_version_idx" ON "alpha_radar_reports" USING btree ("tracked_filer_id","report_period","generator_version");--> statement-breakpoint
CREATE INDEX "alpha_radar_sec_filings_tracked_filer_idx" ON "alpha_radar_sec_filings" USING btree ("tracked_filer_id");--> statement-breakpoint
CREATE INDEX "alpha_radar_sec_filings_period_idx" ON "alpha_radar_sec_filings" USING btree ("report_period");--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_radar_sec_filings_accession_idx" ON "alpha_radar_sec_filings" USING btree ("accession_number");--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_radar_sec_filings_filer_period_type_idx" ON "alpha_radar_sec_filings" USING btree ("tracked_filer_id","report_period","filing_type");--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_radar_tracked_filers_slug_idx" ON "alpha_radar_tracked_filers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "alpha_radar_tracked_filers_cik_idx" ON "alpha_radar_tracked_filers" USING btree ("cik");