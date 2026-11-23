ALTER TABLE "option_positions" DROP CONSTRAINT "option_positions_source_check";--> statement-breakpoint
ALTER TABLE "option_positions" ADD COLUMN "institution_price" numeric;--> statement-breakpoint
ALTER TABLE "option_positions" ADD COLUMN "institution_price_date" date;--> statement-breakpoint
ALTER TABLE "option_positions" ADD CONSTRAINT "option_positions_institution_price_check" CHECK (("option_positions"."institution_price" is null) = ("option_positions"."institution_price_date" is null) and ("option_positions"."institution_price" is null or "option_positions"."institution_price" >= 0));--> statement-breakpoint
ALTER TABLE "option_positions" ADD CONSTRAINT "option_positions_source_check" CHECK ("option_positions"."source" in ('manual', 'csv', 'plaid'));