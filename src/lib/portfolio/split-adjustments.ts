/**
 * Stock splits applied to held positions (follow-up to launch item i32).
 *
 * Prices are split-adjusted, so after a 10-for-1 split the stored close
 * drops from about 1,000 to about 100. An imported position still holds the
 * pre-split quantity and average cost until it is re-imported, which would
 * understate its value by 90% and show a loss that never happened. The
 * nightly ingest therefore adjusts every position in a stock that split:
 * quantity times `splitTo / splitFrom`, average cost (and the cached last
 * price) times `splitFrom / splitTo`. Cost basis and market value are
 * unchanged.
 *
 * Only positions last updated before the split took effect (the market open
 * on its execution date) are adjusted, and an adjusted position's
 * updated_at is set to that moment. So a position is never adjusted twice
 * for one split however often the split is seen, a position re-imported
 * after the split (already post-split) is left alone, and a second split
 * of the same stock later still applies.
 *
 * Trade history (transactions) is not adjusted.
 */

import { and, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdings } from "@/db/schema";
import { easternDateTime } from "@/lib/markets/market-hours";

type Database = typeof db;

const MARKET_OPEN_MINUTES = 9 * 60 + 30;

export interface HoldingSplit {
    symbol: string;
    /** Eastern trading date, YYYY-MM-DD. */
    executionDate: string;
    splitFrom: number;
    splitTo: number;
}

/** When a split takes effect: the market open on its execution date. */
export function splitTakesEffectAt(executionDate: string): Date {
    return easternDateTime(executionDate, MARKET_OPEN_MINUTES);
}

/** "10-for-1", "1-for-20". */
export function describeSplitRatio({ splitFrom, splitTo }: Pick<HoldingSplit, "splitFrom" | "splitTo">): string {
    return `${splitTo}-for-${splitFrom}`;
}

export function buildAdjustHoldingsForSplitQuery(split: HoldingSplit, database: Database = db) {
    const effectiveAt = splitTakesEffectAt(split.executionDate);
    const from = String(split.splitFrom);
    const to = String(split.splitTo);
    return database
        .update(holdings)
        .set({
            quantity: sql`${holdings.quantity} * ${to}::numeric / ${from}::numeric`,
            avgCost: sql`${holdings.avgCost} * ${from}::numeric / ${to}::numeric`,
            currentPrice: sql`${holdings.currentPrice} * ${from}::double precision / ${to}::double precision`,
            updatedAt: effectiveAt,
        })
        .where(and(sql`upper(${holdings.symbol}) = ${split.symbol.trim().toUpperCase()}`, lt(holdings.updatedAt, effectiveAt)))
        .returning({ id: holdings.id });
}

/** Adjusts every position in the stock not yet adjusted for this split; returns how many. */
export async function adjustHoldingsForSplit(split: HoldingSplit, database: Database = db): Promise<number> {
    if (!(split.splitFrom > 0) || !(split.splitTo > 0) || split.splitFrom === split.splitTo) return 0;
    return (await buildAdjustHoldingsForSplitQuery(split, database)).length;
}
