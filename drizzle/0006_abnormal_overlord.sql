CREATE TABLE "plaid_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plaid_item_record_id" uuid NOT NULL,
	"plaid_account_id" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text,
	"mask" text,
	"type" text NOT NULL,
	"subtype" text NOT NULL,
	"current_balance" numeric,
	"iso_currency_code" text,
	"institution_id" text,
	"institution_name" text,
	"capabilities" jsonb NOT NULL,
	"verification_status" text NOT NULL,
	"sync_status" text DEFAULT 'sync_ready' NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plaid_item_id" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"access_token_iv" text NOT NULL,
	"access_token_auth_tag" text NOT NULL,
	"key_version" text DEFAULT 'v1' NOT NULL,
	"last_successful_sync_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plaid_accounts" ADD CONSTRAINT "plaid_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_accounts" ADD CONSTRAINT "plaid_accounts_plaid_item_record_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_record_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plaid_accounts_user_idx" ON "plaid_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plaid_accounts_item_idx" ON "plaid_accounts" USING btree ("plaid_item_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plaid_accounts_user_account_idx" ON "plaid_accounts" USING btree ("user_id","plaid_account_id");--> statement-breakpoint
CREATE INDEX "plaid_items_user_status_idx" ON "plaid_items" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "plaid_items_user_item_idx" ON "plaid_items" USING btree ("user_id","plaid_item_id");