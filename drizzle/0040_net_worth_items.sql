CREATE TABLE "net_worth_item_values" (
	"net_worth_item_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" numeric NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "net_worth_item_values_net_worth_item_id_date_pk" PRIMARY KEY("net_worth_item_id","date"),
	CONSTRAINT "net_worth_item_values_value_check" CHECK ("net_worth_item_values"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "net_worth_item_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "net_worth_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"value" numeric NOT NULL,
	"value_as_of" date NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "net_worth_items_kind_check" CHECK ("net_worth_items"."kind" in ('asset', 'debt')),
	CONSTRAINT "net_worth_items_category_check" CHECK (("net_worth_items"."kind" = 'asset' and "net_worth_items"."category" in ('property', 'vehicle', 'bank_cash', 'valuables', 'owed_to_you', 'other_asset')) or ("net_worth_items"."kind" = 'debt' and "net_worth_items"."category" in ('mortgage', 'auto_loan', 'credit_card', 'student_loan', 'other_debt'))),
	CONSTRAINT "net_worth_items_name_check" CHECK (char_length("net_worth_items"."name") between 1 and 120),
	CONSTRAINT "net_worth_items_value_check" CHECK ("net_worth_items"."value" >= 0),
	CONSTRAINT "net_worth_items_note_check" CHECK ("net_worth_items"."note" is null or char_length("net_worth_items"."note") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "net_worth_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "net_worth_item_values" ADD CONSTRAINT "net_worth_item_values_net_worth_item_id_net_worth_items_id_fk" FOREIGN KEY ("net_worth_item_id") REFERENCES "public"."net_worth_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_items" ADD CONSTRAINT "net_worth_items_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "net_worth_items_user_id_idx" ON "net_worth_items" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "net_worth_item_values" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "net_worth_item_values" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "net_worth_items" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "net_worth_items" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);