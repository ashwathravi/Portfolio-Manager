-- Launch item i44: linked investment accounts sync into portfolios (decision
-- D5), one portfolio per Plaid account, found by (user, source, account id).
ALTER TABLE "plaid_accounts" ALTER COLUMN "sync_status" SET DEFAULT 'awaiting_selection';--> statement-breakpoint
-- Accounts stored before this were all marked sync_ready at Link, picked or
-- not, and none was ever synced (last_synced_at was the time of Link): they
-- wait for the user to pick them, so no account is synced unasked.
UPDATE "plaid_accounts" SET "sync_status" = 'awaiting_selection', "last_synced_at" = NULL WHERE "sync_status" = 'sync_ready';--> statement-breakpoint
ALTER TABLE "plaid_accounts" ADD COLUMN "holdings_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN "last_sync_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "external_account_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolios_user_source_external_account_idx" ON "portfolios" USING btree ("user_id","source","external_account_id") WHERE "portfolios"."external_account_id" is not null;
