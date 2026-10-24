ALTER TABLE "transactions" ADD COLUMN "fees" numeric;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_portfolio_external_id_idx" ON "transactions" USING btree ("portfolio_id","external_id") WHERE "transactions"."external_id" is not null;