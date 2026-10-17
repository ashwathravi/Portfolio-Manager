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

import { and, asc, count, desc, eq, exists, gte, inArray, isNotNull, isNull, lt, lte, max, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { priceBars, securities } from "@/db/schema";
import { tickerSchema } from "@/lib/validators/market-data";

type Database = typeof db;

/**
 * The most securities quote lookups may grow the table to. Holdings and the
 * benchmarks are tracked by the nightly ingest whatever the count; this
 * bounds what arbitrary symbol lookups can add, and with it the storage and
 * the ingest's history work they cause.
 */
export const REQUESTED_TRACKING_LIMIT = 2_000;

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

export function buildTrackSecuritiesQuery(symbols: string[], database: Pick<Database, "insert"> = db) {
    return database
        .insert(securities)
        .values(symbols.map((symbol) => ({ symbol })))
        .onConflictDoNothing({ target: securities.symbol })
        .returning({ symbol: securities.symbol });
}

export function buildUpsertBarsQuery(bars: PriceBarInput[], database: Pick<Database, "insert"> = db) {
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

/**
 * The newest `perSymbol` closes for each symbol, newest first: what a quote
 * needs (the latest close and the one before it).
 */
export function buildRecentClosesQuery(symbols: string[], perSymbol: number, database: Database = db) {
    const ranked = database
        .select({
            symbol: priceBars.symbol,
            date: priceBars.date,
            close: priceBars.close,
            rank: sql<number>`row_number() over (partition by ${priceBars.symbol} order by ${priceBars.date} desc)`.as("rank"),
        })
        .from(priceBars)
        .where(inArray(priceBars.symbol, symbols))
        .as("ranked");
    return database
        .select({ symbol: ranked.symbol, date: ranked.date, close: ranked.close })
        .from(ranked)
        .where(lte(ranked.rank, perSymbol))
        .orderBy(asc(ranked.symbol), desc(ranked.date));
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

/** Any bar stored for the security: it has appeared in a market-wide daily file. */
const hasBars = (database: Pick<Database, "select">) =>
    exists(database.select({ one: sql`1` }).from(priceBars).where(eq(priceBars.symbol, securities.symbol)));

/**
 * Waiting for a history backfill. A symbol only a quote lookup asked for
 * waits until a daily file has priced it, so a made-up ticker never costs a
 * provider call; `priority` symbols (held, benchmarks) qualify at once.
 */
const needsHistory = (priority: readonly string[], database: Pick<Database, "select">) =>
    and(
        isNull(securities.historyStartDate),
        eq(securities.active, true),
        priority.length > 0 ? or(inArray(securities.symbol, [...priority]), hasBars(database)) : hasBars(database),
    );

/** Puts symbols back in the history queue (after a split rescales their adjusted bars). */
export function buildResetHistoryQuery(symbols: string[], database: Database = db) {
    return database
        .update(securities)
        .set({ historyStartDate: null, updatedAt: new Date() })
        .where(and(inArray(securities.symbol, symbols), isNotNull(securities.historyStartDate)))
        .returning({ symbol: securities.symbol });
}

/** The backfill queue: `priority` symbols first, then oldest tracked first. */
export function buildSymbolsNeedingHistoryQuery(limit: number, priority: readonly string[] = [], database: Database = db) {
    const first = priority.length > 0
        ? [sql`case when ${inArray(securities.symbol, [...priority])} then 0 else 1 end`]
        : [];
    return database
        .select({ symbol: securities.symbol })
        .from(securities)
        .where(needsHistory(priority, database))
        .orderBy(...first, asc(securities.createdAt), asc(securities.symbol))
        .limit(limit);
}

export function buildSymbolsNeedingHistoryCountQuery(priority: readonly string[] = [], database: Database = db) {
    return database.select({ count: count() }).from(securities).where(needsHistory(priority, database));
}

/**
 * Securities nobody holds that never got a bar: tickers a quote lookup asked
 * for that no daily file has (made up, or not a listed stock). Removing them
 * frees room under REQUESTED_TRACKING_LIMIT. `keep` (held, benchmarks) stay.
 */
export function buildPruneUnpricedSecuritiesQuery(keep: readonly string[], trackedBefore: Date, database: Database = db) {
    return database
        .delete(securities)
        .where(and(
            lt(securities.createdAt, trackedBefore),
            isNull(securities.historyStartDate),
            keep.length > 0 ? notInArray(securities.symbol, [...keep]) : undefined,
            sql`not ${hasBars(database)}`,
        ))
        .returning({ symbol: securities.symbol });
}

export function buildHasBarsQuery(symbol: string, database: Database = db) {
    return database.select({ symbol: priceBars.symbol }).from(priceBars).where(eq(priceBars.symbol, symbol)).limit(1);
}

/** The newest bar date stored for any symbol (served by price_bars_date_idx). */
export function buildLatestBarDateQuery(database: Database = db) {
    return database.select({ date: max(priceBars.date) }).from(priceBars);
}

/** Which of these symbols are tracked already. */
export function buildTrackedAmongQuery(symbols: string[], database: Pick<Database, "select"> = db) {
    return database.select({ symbol: securities.symbol }).from(securities).where(inArray(securities.symbol, symbols));
}

export function buildTrackedCountQuery(database: Pick<Database, "select"> = db) {
    return database.select({ count: count() }).from(securities);
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

/**
 * Serializes requested-tracking reservations across instances. Held for the
 * transaction only, so it works through a transaction pooler.
 */
export const REQUESTED_TRACKING_LOCK = sql`select pg_advisory_xact_lock(hashtext('atlas:requested-tracking'))`;

/**
 * Starts tracking symbols a quote lookup asked for, only while the table has
 * room under `limit`. Symbols tracked already take no room. Returns the
 * symbols added and those refused for lack of room, which stay unpriced
 * until room frees up. The count and the insert run in one transaction
 * under an advisory lock, so concurrent instances can't each see room and
 * together pass the limit.
 */
export async function trackRequestedSecurities(
    symbols: Iterable<string>,
    limit: number = REQUESTED_TRACKING_LIMIT,
    database: Database = db,
): Promise<{ added: string[]; refused: string[] }> {
    const normalized = normalizeSymbols(symbols);
    if (!normalized.length) return { added: [], refused: [] };
    return database.transaction(async (tx) => {
        await tx.execute(REQUESTED_TRACKING_LOCK);
        const existing = new Set((await buildTrackedAmongQuery(normalized, tx)).map((row) => row.symbol));
        const fresh = normalized.filter((symbol) => !existing.has(symbol));
        if (!fresh.length) return { added: [], refused: [] };

        const [row] = await buildTrackedCountQuery(tx);
        const room = Math.max(0, limit - Number(row?.count ?? 0));
        const refused = fresh.slice(room);
        if (refused.length > 0) {
            console.warn(`Price store is at its limit of ${limit} securities: not tracking ${refused.length} requested symbol(s).`);
        }
        if (room === 0) return { added: [], refused };
        const inserted = await buildTrackSecuritiesQuery(fresh.slice(0, room), tx);
        return { added: inserted.map((added) => added.symbol), refused };
    });
}

export async function listTrackedSymbols(database: Database = db): Promise<Set<string>> {
    const rows = await database.select({ symbol: securities.symbol }).from(securities);
    return new Set(rows.map((row) => row.symbol));
}

/** Tracked symbols whose history hasn't been backfilled yet, oldest first. */
export async function listSymbolsNeedingHistory(
    limit: number,
    priority: readonly string[] = [],
    database: Database = db,
): Promise<string[]> {
    const rows = await buildSymbolsNeedingHistoryQuery(limit, priority, database);
    return rows.map((row) => row.symbol);
}

/** How many tracked symbols are still waiting for their history backfill. */
export async function countSymbolsNeedingHistory(priority: readonly string[] = [], database: Database = db): Promise<number> {
    const [row] = await buildSymbolsNeedingHistoryCountQuery(priority, database);
    return row?.count ?? 0;
}

/** Removes unpriced securities tracked before `trackedBefore`; returns their symbols. */
export async function pruneUnpricedSecurities(
    keep: Iterable<string>,
    trackedBefore: Date,
    database: Database = db,
): Promise<string[]> {
    const rows = await buildPruneUnpricedSecuritiesQuery(normalizeSymbols(keep), trackedBefore, database);
    return rows.map((row) => row.symbol);
}

/** Whether any bar is stored for the symbol. */
export async function hasStoredBars(symbol: string, database: Database = db): Promise<boolean> {
    return (await buildHasBarsQuery(symbol, database)).length > 0;
}

/** The newest date in price_bars, or null when nothing is stored yet. */
export async function getLatestBarDate(database: Database = db): Promise<string | null> {
    const [row] = await buildLatestBarDateQuery(database);
    return row?.date ?? null;
}

/** Puts symbols whose history was loaded back in the queue; returns the ones reset. */
export async function resetHistory(symbols: Iterable<string>, database: Database = db): Promise<string[]> {
    const normalized = normalizeSymbols(symbols);
    if (!normalized.length) return [];
    return (await buildResetHistoryQuery(normalized, database)).map((row) => row.symbol);
}

export function buildMarkHistoryLoadedQuery(symbol: string, startDate: string, database: Pick<Database, "update"> = db) {
    return database
        .update(securities)
        .set({ historyStartDate: startDate, updatedAt: new Date() })
        .where(eq(securities.symbol, symbol));
}

export async function markHistoryLoaded(symbol: string, startDate: string, database: Database = db): Promise<void> {
    await buildMarkHistoryLoadedQuery(symbol, startDate, database);
}

/** A symbol's bars up to and including `through`. */
export function buildDeleteHistoryQuery(symbol: string, through: string, database: Pick<Database, "delete"> = db) {
    return database.delete(priceBars).where(and(eq(priceBars.symbol, symbol), lte(priceBars.date, through)));
}

/**
 * Replaces a symbol's stored bars with a freshly fetched history (cut off at
 * `through`) and records where it starts, in one transaction. Every stored
 * bar up to the history's last day goes, older ones too: after a split those
 * are on the old scale, and the provider's adjusted history is the one to
 * keep. Bars after the history's last day (from the daily files, if the
 * history lags) are left alone. Returns undefined, changing nothing, when no
 * bar is valid.
 */
export async function replaceHistory(
    symbol: string,
    bars: readonly PriceBarInput[],
    through: string,
    database: Database = db,
): Promise<{ stored: number; rejected: number; historyStart: string } | undefined> {
    const own = bars.filter((bar) => bar.symbol === symbol && bar.date <= through);
    const valid = dedupeBars(own.filter(isValidBar));
    if (valid.length === 0) return undefined;
    const historyStart = valid.reduce((earliest, bar) => (bar.date < earliest ? bar.date : earliest), valid[0].date);
    const historyEnd = valid.reduce((latest, bar) => (bar.date > latest ? bar.date : latest), valid[0].date);
    await database.transaction(async (tx) => {
        await buildDeleteHistoryQuery(symbol, historyEnd, tx);
        for (let start = 0; start < valid.length; start += UPSERT_CHUNK_SIZE) {
            await buildUpsertBarsQuery(valid.slice(start, start + UPSERT_CHUNK_SIZE), tx);
        }
        await buildMarkHistoryLoadedQuery(symbol, historyStart, tx);
    });
    return { stored: valid.length, rejected: bars.length - own.filter(isValidBar).length, historyStart };
}

/**
 * Inserts or replaces bars in one transaction. Invalid bars are skipped and
 * counted rather than failing the batch, so one bad provider row can't stop
 * a nightly ingest.
 * A repeated (symbol, date) is written once, with its last values.
 */
export async function upsertBars(
    bars: readonly PriceBarInput[],
    database: Database = db,
): Promise<{ stored: number; rejected: number }> {
    const valid = dedupeBars(bars.filter(isValidBar));
    if (valid.length > 0) {
        // All chunks or none: the ingest resumes from the newest stored date,
        // so a day must never be left half-written.
        await database.transaction(async (tx) => {
            for (let start = 0; start < valid.length; start += UPSERT_CHUNK_SIZE) {
                await buildUpsertBarsQuery(valid.slice(start, start + UPSERT_CHUNK_SIZE), tx);
            }
        });
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

/** The newest closes per symbol (default: the latest two), newest first. */
export async function getRecentCloses(
    symbols: Iterable<string>,
    perSymbol = 2,
    database: Database = db,
): Promise<Map<string, LatestClose[]>> {
    const normalized = normalizeSymbols(symbols);
    if (!normalized.length) return new Map();
    const closes = new Map<string, LatestClose[]>();
    for (const row of await buildRecentClosesQuery(normalized, perSymbol, database)) {
        const list = closes.get(row.symbol) ?? [];
        list.push({ date: row.date, close: row.close });
        closes.set(row.symbol, list);
    }
    return closes;
}

export async function getBars(
    symbol: string,
    from: string,
    to: string,
    database: Database = db,
): Promise<PriceBarInput[]> {
    return buildBarsQuery(symbol, from, to, database);
}
