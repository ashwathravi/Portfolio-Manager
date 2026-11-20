ALTER TABLE "portfolios" ADD COLUMN "account_type" text;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "institution" text;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "tax_treatment" text;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_account_type_check" CHECK ("portfolios"."account_type" in ('brokerage', '401k', '403b', 'traditional_ira', 'roth_ira', 'sep_ira', 'pension', '529', 'hsa', 'equity_comp', 'crypto', 'other'));--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_tax_treatment_check" CHECK ("portfolios"."tax_treatment" in ('taxable', 'tax_deferred', 'tax_free'));--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_institution_check" CHECK (char_length("portfolios"."institution") between 1 and 80);