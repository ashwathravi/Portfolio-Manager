ALTER TABLE "portfolios" ADD COLUMN "ownership" text;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "kind_edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_ownership_check" CHECK ("portfolios"."ownership" in ('individual', 'joint', 'dependent', 'business'));