-- One row per symbol in an account (launch item i41). Symbols are stored
-- upper-case, as the CSV import writes them. A holding is a snapshot of the
-- position (an import replaces it, and lots of one symbol are combined
-- before they're stored), so rows that repeat a symbol in an account, from
-- a race or an older import that differed only by case or spacing, are
-- copies of the same position, not separate lots. The most recently updated
-- copy is kept as it is (its quantity, cost, and updated_at, the stock
-- split watermark in src/lib/portfolio/split-adjustments.ts) and the rest
-- are removed: summing them would count the position twice, and could mix
-- rows on either side of a split.
UPDATE "holdings" SET "symbol" = upper(btrim("symbol")) WHERE "symbol" <> upper(btrim("symbol"));--> statement-breakpoint
DELETE FROM "holdings" AS "h"
USING (
	SELECT
		"portfolio_id",
		"symbol",
		(array_agg("id" ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC))[1] AS "keep_id"
	FROM "holdings"
	GROUP BY "portfolio_id", "symbol"
	HAVING count(*) > 1
) AS "g"
WHERE "h"."portfolio_id" = "g"."portfolio_id" AND "h"."symbol" = "g"."symbol" AND "h"."id" <> "g"."keep_id";--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_portfolio_symbol_idx" ON "holdings" USING btree ("portfolio_id","symbol");
