-- One row per symbol in an account (launch item i41). Symbols are stored
-- upper-case, as the CSV import writes them; rows that differ only by case
-- or spacing, or that a race wrote twice, are merged first: quantities
-- summed, average cost weighted by quantity, kept on the oldest row. The
-- merged row keeps the group's earliest updated_at, which is the stock
-- split watermark (src/lib/portfolio/split-adjustments.ts): a split still
-- due for these rows is still applied to it.
UPDATE "holdings" SET "symbol" = upper(btrim("symbol")) WHERE "symbol" <> upper(btrim("symbol"));--> statement-breakpoint
WITH "groups" AS (
	SELECT
		"portfolio_id",
		"symbol",
		(array_agg("id" ORDER BY "created_at", "id"))[1] AS "keep_id",
		sum("quantity") AS "quantity",
		sum("quantity" * "avg_cost") AS "cost",
		min("updated_at") AS "updated_at"
	FROM "holdings"
	GROUP BY "portfolio_id", "symbol"
	HAVING count(*) > 1
)
UPDATE "holdings" AS "h"
SET
	"quantity" = "g"."quantity",
	"avg_cost" = CASE WHEN "g"."quantity" <> 0 THEN "g"."cost" / "g"."quantity" ELSE "h"."avg_cost" END,
	-- Computed for the old quantity: readers fall back to quantity × price.
	"market_value" = NULL,
	"allocation" = NULL,
	"updated_at" = "g"."updated_at"
FROM "groups" AS "g"
WHERE "h"."id" = "g"."keep_id";--> statement-breakpoint
DELETE FROM "holdings" AS "h"
USING (
	SELECT "portfolio_id", "symbol", (array_agg("id" ORDER BY "created_at", "id"))[1] AS "keep_id"
	FROM "holdings"
	GROUP BY "portfolio_id", "symbol"
	HAVING count(*) > 1
) AS "g"
WHERE "h"."portfolio_id" = "g"."portfolio_id" AND "h"."symbol" = "g"."symbol" AND "h"."id" <> "g"."keep_id";--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_portfolio_symbol_idx" ON "holdings" USING btree ("portfolio_id","symbol");
