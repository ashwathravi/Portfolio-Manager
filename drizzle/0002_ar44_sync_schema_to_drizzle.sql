ALTER TABLE "holdings" RENAME COLUMN "ticker" TO "symbol";--> statement-breakpoint
ALTER TABLE "transactions" RENAME COLUMN "ticker" TO "symbol";--> statement-breakpoint
ALTER TABLE "transactions" RENAME COLUMN "date" TO "timestamp";--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "quantity" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "avg_cost" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "quantity" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "price" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "user_id" uuid;--> statement-breakpoint
CREATE INDEX "holdings_symbol_idx" ON "holdings" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "transactions_symbol_idx" ON "transactions" USING btree ("symbol");