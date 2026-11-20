CREATE TABLE "manual_holding_values" (
	"manual_holding_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" numeric NOT NULL,
	"quantity" numeric,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manual_holding_values_manual_holding_id_date_pk" PRIMARY KEY("manual_holding_id","date"),
	CONSTRAINT "manual_holding_values_value_check" CHECK ("manual_holding_values"."value" >= 0),
	CONSTRAINT "manual_holding_values_quantity_check" CHECK ("manual_holding_values"."quantity" is null or "manual_holding_values"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "manual_holding_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manual_holding_values" ADD CONSTRAINT "manual_holding_values_manual_holding_id_manual_holdings_id_fk" FOREIGN KEY ("manual_holding_id") REFERENCES "public"."manual_holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "server_only_no_client_access" ON "manual_holding_values" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "app_runtime_access" ON "manual_holding_values" AS PERMISSIVE FOR ALL TO "app_runtime" USING (true) WITH CHECK (true);--> statement-breakpoint
-- Each holding's value so far, as of its own date.
INSERT INTO "manual_holding_values" ("manual_holding_id", "date", "value", "quantity")
SELECT "id", "value_as_of", "value", "quantity" FROM "manual_holdings";