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
 * Only positions last updated before the split took effect (the start of its
 * execution date, Eastern: the adjustment happens overnight, and even
 * pre-market trading that day is on the new scale) are adjusted, and an
 * adjusted position's updated_at is set to that moment. So a position is
 * never adjusted twice for one split however often the split is seen, a
 * position re-imported after the split (already post-split) is left alone,
 * and a second split of the same stock later still applies.
 *
 * Trade history (transactions) is not adjusted.
 */

import { and, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdings } from "@/db/schema";
import { easternDateTime } from "@/lib/markets/market-hours";

type Database = typeof db;

export interface HoldingSplit {
    symbol: string;
    /** Eastern trading date, YYYY-MM-DD. */
    executionDate: string;
    splitFrom: number;
    splitTo: number;
}

/**
 * When a split takes effect: midnight Eastern starting its execution date.
 * A position imported after that, even pre-market, is already post-split.
 */
export function splitTakesEffectAt(executionDate: string): Date {
    return easternDateTime(executionDate, 0);
}

/**
 * Several actions for one stock on one execution date (a split and a stock
 * dividend, say) as one ratio, so a position gets all of them in one
 * update: the second would otherwise find it already marked as adjusted for
 * that date. The same action listed twice (same provider id) counts once.
 * Undefined when the day can't be applied safely: an action without a
 * usable ratio, or several actions of which one has no id (equal ratios
 * don't prove two rows are the same action, so neither guess is safe).
 */
export function combineSameDaySplits(
    events: ReadonlyArray<{ symbol: string; executionDate: string; splitFrom?: number; splitTo?: number; id?: string }>,
): HoldingSplit | undefined {
    if (events.length === 0) return undefined;
    if (events.length > 1 && events.some((event) => !event.id)) return undefined;
    const seen = new Set<string>();
    let splitFrom = 1;
    let splitTo = 1;
    for (const event of events) {
        if (event.splitFrom === undefined || event.splitTo === undefined) return undefined;
        if (event.id) {
            if (seen.has(event.id)) continue;
            seen.add(event.id);
        }
        splitFrom *= event.splitFrom;
        splitTo *= event.splitTo;
    }
    return { symbol: events[0].symbol, executionDate: events[0].executionDate, splitFrom, splitTo };
}

export interface HoldingSplitOutcome {
    adjusted: Array<{ symbol: string; executionDate: string; ratio: string; positions: number }>;
    /** Stocks with a split that couldn't be applied safely (no ratio, or ambiguous same-day actions). */
    unadjusted: string[];
}

/**
 * Applies split events to held positions: one update per stock and
 * execution date, oldest first (so a later split applies on top of an
 * earlier one). Events for stocks not in `held` are ignored. Safe to repeat
 * with the same events: see {@link buildAdjustHoldingsForSplitQuery}.
 */
export async function reconcileHoldingSplits(
    events: ReadonlyArray<{ symbol: string; executionDate: string; splitFrom?: number; splitTo?: number; id?: string }>,
    held: ReadonlySet<string>,
    adjust: (split: HoldingSplit) => Promise<number>,
): Promise<HoldingSplitOutcome> {
    const byDay = new Map<string, typeof events[number][]>();
    for (const event of events) {
        if (!held.has(event.symbol)) continue;
        const key = `${event.executionDate}|${event.symbol}`;
        byDay.set(key, [...(byDay.get(key) ?? []), event]);
    }
    const outcome: HoldingSplitOutcome = { adjusted: [], unadjusted: [] };
    for (const key of [...byDay.keys()].sort()) {
        const dayEvents = byDay.get(key)!;
        const split = combineSameDaySplits(dayEvents);
        if (!split) {
            if (!outcome.unadjusted.includes(dayEvents[0].symbol)) outcome.unadjusted.push(dayEvents[0].symbol);
            continue;
        }
        const positions = await adjust(split);
        if (positions > 0) {
            outcome.adjusted.push({ symbol: split.symbol, executionDate: split.executionDate, ratio: describeSplitRatio(split), positions });
        }
    }
    return outcome;
}

/** Each held stock (upper case) and when its least recently updated position last changed. */
export function buildHeldSinceQuery(database: Database = db) {
    return database
        // Mapped like the column itself: a zone-less timestamp read as UTC,
        // not as the server's local time.
        .select({ symbol: sql<string>`upper(${holdings.symbol})`, since: sql<Date>`min(${holdings.updatedAt})`.mapWith(holdings.updatedAt) })
        .from(holdings)
        .groupBy(sql`upper(${holdings.symbol})`);
}

export async function listHeldSince(database: Database = db): Promise<Array<{ symbol: string; since: Date }>> {
    return (await buildHeldSinceQuery(database)).map((row) => ({ symbol: row.symbol, since: row.since }));
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
