/**
 * Postgres price store (launch item i31): the tracked securities and their
 * daily bars, shared by every server instance and kept across cold starts.
 *
 * Callers track a symbol first (anything held, watched or used as a
 * benchmark), then store bars for it; `price_bars` has a foreign key to
 * `securities`, so bars for untracked symbols are rejected. The nightly ingest
 * uses {@link selectTrackedBars} to cut the market-wide daily file down to the
 * tracked set before writing.
 *
 * Quotes are not stored here: they live a minute and belong in the shared
 * cache. Closing prices from this store are what valuations and "last close"
 * labels read.
 */

import { and, asc, count, desc, eq, gte, inArray, isNull, lte, max, sql } from "drizzle-orm";

import { db } from "@/db";
import { priceBars, securities } from "@/db/schema";
import { tickerSchema } from "@/lib/validators/market-data";

type Database = typeof db;

export interface PriceBarInput {
    symbol: string;
    /** Eastern trading date, YYYY-MM-DD. */
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    /** Provider that supplied the bar, e.g. "massive". */
    source: string;
}

export interface LatestClose {
    date: string;
    close: number;
}

// 8 bound parameters per row keeps each statement far below Postgres's
// 65,535-parameter limit.
const UPSERT_CHUNK_SIZE = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Uppercases, trims and dedupes symbols, dropping anything that isn't a
 * plain ticker (option contracts, cash lines, blanks). Order is preserved.
 */
export function normalizeSymbols(symbols: Iterable<string>): string[] {
    const seen = new Set<string>();
    for (const raw of symbols) {
        const symbol = raw.trim().toUpperCase();
        if (tickerSchema.safeParse(symbol).success) seen.add(symbol);
    }
    return [...seen];
}

/** True when a bar is internally consistent and safe to store. */
export function isValidBar(bar: PriceBarInput): boolean {
    const prices = [bar.open, bar.high, bar.low, bar.close];
    return tickerSchema.safeParse(bar.symbol).success
        && isCalendarDate(bar.date)
        && bar.source.trim().length > 0
        && prices.every((value) => Number.isFinite(value) && value > 0)
        && Number.isFinite(bar.volume) && bar.volume >= 0
        && bar.high >= Math.max(bar.open, bar.close, bar.low)
        && bar.low <= Math.min(bar.open, bar.close);
}

/** YYYY-MM-DD that names a real day: 2026-02-30 and 2026-13-01 are refused. */
function isCalendarDate(date: string): boolean {
    if (!ISO_DATE.test(date)) return false;
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === date;
}

/**
 * One bar per (symbol, date), keeping the last one given. Postgres refuses an
 * upsert that touches the same row twice, which overlapping backfill pages would.
 */
export function dedupeBars(bars: readonly PriceBarInput[]): PriceBarInput[] {
    const byKey = new Map<string, PriceBarInput>();
    for (const bar of bars) byKey.set(`${bar.symbol}|${bar.date}`, bar);
    return [...byKey.values()];
}

/** Keeps the bars whose symbol is in the tracked set. */
export function selectTrackedBars(bars: readonly PriceBarInput[], tracked: ReadonlySet<string>): PriceBarInput[] {
    return bars.filter((bar) => tracked.has(bar.symbol));
}

// ---------------------------------------------------------------------------
// Query builders (compiled in tests; executed by the functions below)
// ---------------------------------------------------------------------------

export function buildTrackSecuritiesQuery(symbols: string[], database: Database = db) {
    return database
        .insert(securities)
        .values(symbols.map((symbol) => ({ symbol })))
        .onConflictDoNothing({ target: securities.symbol })
        .returning({ symbol: securities.symbol });
}

export function buildUpsertBarsQuery(bars: PriceBarInput[], database: Database = db) {
    return database
        .insert(priceBars)
        .values(bars.map((bar) => ({ ...bar, updatedAt: new Date() })))
        .onConflictDoUpdate({
            target: [priceBars.symbol, priceBars.date],
            set: {
                open: sql`excluded.open`,
                high: sql`excluded.high`,
                low: sql`excluded.low`,
                close: sql`excluded.close`,
                volume: sql`excluded.volume`,
                source: sql`excluded.source`,
                updatedAt: sql`excluded.updated_at`,
            },
        });
}

/** The most recent close per symbol, optionally as of a date (inclusive). */
export function buildLatestClosesQuery(symbols: string[], onOrBefore?: string, database: Database = db) {
    return database
        .selectDistinctOn([priceBars.symbol], {
            symbol: priceBars.symbol,
            date: priceBars.date,
            close: priceBars.close,
        })
        .from(priceBars)
        .where(and(
            inArray(priceBars.symbol, symbols),
            onOrBefore ? lte(priceBars.date, onOrBefore) : undefined,
        ))
        .orderBy(priceBars.symbol, desc(priceBars.date));
}

export function buildBarsQuery(symbol: string, from: string, to: string, database: Database = db) {
    return database
        .select({
            symbol: priceBars.symbol,
            date: priceBars.date,
            open: priceBars.open,
            high: priceBars.high,
            low: priceBars.low,
            close: priceBars.close,
            volume: priceBars.volume,
            source: priceBars.source,
        })
        .from(priceBars)
        .where(and(eq(priceBars.symbol, symbol), gte(priceBars.date, from), lte(priceBars.date, to)))
        .orderBy(asc(priceBars.date));
}

const needsHistory = () => and(isNull(securities.historyStartDate), eq(securities.active, true));

export function buildSymbolsNeedingHistoryQuery(limit: number, database: Database = db) {
    return database
        .select({ symbol: securities.symbol })
        .from(securities)
        .where(needsHistory())
        .orderBy(asc(securities.createdAt), asc(securities.symbol))
        .limit(limit);
}

export function buildSymbolsNeedingHistoryCountQuery(database: Database = db) {
    return database.select({ count: count() }).from(securities).where(needsHistory());
}

/** The newest bar date stored for any symbol (served by price_bars_date_idx). */
export function buildLatestBarDateQuery(database: Database = db) {
    return database.select({ date: max(priceBars.date) }).from(priceBars);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Starts tracking symbols; returns the ones that weren't tracked before. */
export async function trackSecurities(symbols: Iterable<string>, database: Database = db): Promise<string[]> {
    const normalized = normalizeSymbols(symbols);
    if (!normalized.length) return [];
    const inserted = await buildTrackSecuritiesQuery(normalized, database);
    return inserted.map((row) => row.symbol);
}

export async function listTrackedSymbols(database: Database = db): Promise<Set<string>> {
    const rows = await database.select({ symbol: securities.symbol }).from(securities);
    return new Set(rows.map((row) => row.symbol));
}

/** Tracked symbols whose history hasn't been backfilled yet, oldest first. */
export async function listSymbolsNeedingHistory(limit: number, database: Database = db): Promise<string[]> {
    const rows = await buildSymbolsNeedingHistoryQuery(limit, database);
    return rows.map((row) => row.symbol);
}

/** How many tracked symbols are still waiting for their history backfill. */
export async function countSymbolsNeedingHistory(database: Database = db): Promise<number> {
    const [row] = await buildSymbolsNeedingHistoryCountQuery(database);
    return row?.count ?? 0;
}

/** The newest date in price_bars, or null when nothing is stored yet. */
export async function getLatestBarDate(database: Database = db): Promise<string | null> {
    const [row] = await buildLatestBarDateQuery(database);
    return row?.date ?? null;
}

export async function markHistoryLoaded(symbol: string, startDate: string, database: Database = db): Promise<void> {
    await database
        .update(securities)
        .set({ historyStartDate: startDate, updatedAt: new Date() })
        .where(eq(securities.symbol, symbol));
}

/**
 * Inserts or replaces bars. Invalid bars are skipped and counted rather than
 * failing the batch, so one bad provider row can't stop a nightly ingest.
 * A repeated (symbol, date) is written once, with its last values.
 */
export async function upsertBars(
    bars: readonly PriceBarInput[],
    database: Database = db,
): Promise<{ stored: number; rejected: number }> {
    const valid = dedupeBars(bars.filter(isValidBar));
    for (let start = 0; start < valid.length; start += UPSERT_CHUNK_SIZE) {
        await buildUpsertBarsQuery(valid.slice(start, start + UPSERT_CHUNK_SIZE), database);
    }
    return { stored: valid.length, rejected: bars.filter((bar) => !isValidBar(bar)).length };
}

export async function getLatestCloses(
    symbols: Iterable<string>,
    onOrBefore?: string,
    database: Database = db,
): Promise<Map<string, LatestClose>> {
    const normalized = normalizeSymbols(symbols);
    if (!normalized.length) return new Map();
    const rows = await buildLatestClosesQuery(normalized, onOrBefore, database);
    return new Map(rows.map((row) => [row.symbol, { date: row.date, close: row.close }]));
}

export async function getBars(
    symbol: string,
    from: string,
    to: string,
    database: Database = db,
): Promise<PriceBarInput[]> {
    return buildBarsQuery(symbol, from, to, database);
}
