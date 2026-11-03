/**
 * Delayed intraday quotes in Postgres (launch item i33).
 *
 * Finnhub's free plan prices one symbol per call and allows 60 calls a
 * minute for the whole app, while every server instance and every open page
 * asks for prices. So the newest quote per symbol lives in `intraday_quotes`,
 * shared by every instance: a symbol is fetched at most once a minute
 * however many people look at it. An instance claims the symbols it will
 * fetch, under an advisory lock, and each claim stamps `claimed_at`; the
 * claims of the last minute are the calls of the last minute, so the lock
 * also keeps the whole app under its call budget. A symbol with no quote at
 * the provider is asked about again only every ten minutes, and once today's
 * session has closed a quote fetched after the closing prints is final.
 *
 * Only tracked securities get a row (a foreign key to `securities`), which
 * bounds the table the same way it bounds the price store.
 */

import { eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { intradayQuotes, securities } from "@/db/schema";

import type { RegularSession } from "./market-hours";

type Database = typeof db;

/** How old a quote may get before it is fetched again. */
export const INTRADAY_REFRESH_MS = 60_000;
/** How long before a symbol the provider had no quote for is asked about again. */
export const NO_QUOTE_RETRY_MS = 10 * 60_000;
/** A quote fetched this long after the close carries the closing prints. */
export const FINAL_AFTER_CLOSE_MS = 5 * 60_000;

export interface CallBudget {
    limit: number;
    windowMs: number;
}

/**
 * Finnhub's free plan allows 60 calls a minute; ten are left for clock
 * differences and anything else using the key, and a second of slack covers
 * instances whose clocks disagree.
 */
export const FINNHUB_CALL_BUDGET: CallBudget = { limit: 50, windowMs: 61_000 };

/** A tracked symbol and its stored quote; the quote fields are null when it has never been claimed. */
export interface IntradayRow {
    symbol: string;
    price: number | null;
    previousClose: number | null;
    quotedAt: Date | null;
    claimedAt: Date | null;
    fetchedAt: Date | null;
}

/** What a fetch came back with: a quote, or `null` when the provider has none for the symbol. */
export interface IntradayResult {
    symbol: string;
    quote: { price: number; previousClose: number; quotedAt: Date } | null;
}

/** True when a symbol's quote is due to be fetched (again). */
export function needsRefresh(row: IntradayRow, now: Date, session: Pick<RegularSession, "closeAt">): boolean {
    if (!row.claimedAt) return true;
    const claimed = row.claimedAt.getTime();
    // Fetched after today's closing prints: nothing changes until tomorrow.
    if (now >= session.closeAt && claimed >= session.closeAt.getTime() + FINAL_AFTER_CLOSE_MS) return false;
    const noQuote = row.fetchedAt !== null && row.price === null;
    return now.getTime() - claimed >= (noQuote ? NO_QUOTE_RETRY_MS : INTRADAY_REFRESH_MS);
}

/**
 * The symbols to fetch now, at most `room` of them: those due, the
 * longest-waiting first (never-claimed ones before any), so with more
 * symbols than budget every one still gets its turn.
 */
export function chooseClaims(
    rows: readonly IntradayRow[],
    room: number,
    now: Date,
    session: Pick<RegularSession, "closeAt">,
): string[] {
    if (room <= 0) return [];
    return rows
        .filter((row) => needsRefresh(row, now, session))
        .sort((a, b) => (a.claimedAt?.getTime() ?? -Infinity) - (b.claimedAt?.getTime() ?? -Infinity))
        .slice(0, room)
        .map((row) => row.symbol);
}

/** Serializes claims across instances; held for the transaction only, so it works through a pooler. */
export const INTRADAY_CLAIM_LOCK = sql`select pg_advisory_xact_lock(hashtext('atlas:intraday-quotes'))`;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The tracked symbols among `symbols`, each with its stored quote (if any). */
export function buildIntradayRowsQuery(symbols: string[], database: Pick<Database, "select"> = db) {
    return database
        .select({
            symbol: securities.symbol,
            price: intradayQuotes.price,
            previousClose: intradayQuotes.previousClose,
            quotedAt: intradayQuotes.quotedAt,
            claimedAt: intradayQuotes.claimedAt,
            fetchedAt: intradayQuotes.fetchedAt,
        })
        .from(securities)
        .leftJoin(intradayQuotes, eq(intradayQuotes.symbol, securities.symbol))
        .where(inArray(securities.symbol, symbols));
}

/** Calls claimed since `since`, across every instance. */
export function buildRecentClaimsCountQuery(since: Date, database: Pick<Database, "select"> = db) {
    return database
        .select({ count: sql<number>`count(*)::int` })
        .from(intradayQuotes)
        .where(gt(intradayQuotes.claimedAt, since));
}

export function buildClaimQuery(symbols: string[], at: Date, source: string, database: Pick<Database, "insert"> = db) {
    return database
        .insert(intradayQuotes)
        .values(symbols.map((symbol) => ({ symbol, claimedAt: at, source })))
        .onConflictDoUpdate({ target: intradayQuotes.symbol, set: { claimedAt: at } });
}

/**
 * Stores what each fetch came back with. A symbol the provider has no quote
 * for loses the old one, so yesterday's price is never served as today's.
 * Only rows still on the claim that fetched them are written: a slow fetch
 * that lands after another instance claimed the symbol again doesn't
 * overwrite a newer quote.
 */
export function buildSaveResultsQuery(
    results: readonly IntradayResult[],
    claimedAt: Date,
    fetchedAt: Date,
    source: string,
    database: Pick<Database, "insert"> = db,
) {
    return database
        .insert(intradayQuotes)
        .values(results.map(({ symbol, quote }) => ({
            symbol,
            price: quote?.price ?? null,
            previousClose: quote?.previousClose ?? null,
            quotedAt: quote?.quotedAt ?? null,
            claimedAt,
            fetchedAt,
            source,
        })))
        .onConflictDoUpdate({
            target: intradayQuotes.symbol,
            set: {
                price: sql`excluded.price`,
                previousClose: sql`excluded.previous_close`,
                quotedAt: sql`excluded.quoted_at`,
                fetchedAt: sql`excluded.fetched_at`,
                source: sql`excluded.source`,
            },
            setWhere: eq(intradayQuotes.claimedAt, claimedAt),
        });
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function readIntradayRows(symbols: readonly string[], database: Database = db): Promise<IntradayRow[]> {
    if (!symbols.length) return [];
    return buildIntradayRowsQuery([...symbols], database);
}

/**
 * Claims the symbols to fetch now, within what the budget has left this
 * minute, and returns them with every row as it stood under the lock.
 */
export async function claimIntradayQuotes(
    symbols: readonly string[],
    { now, session, budget, source }: { now: Date; session: Pick<RegularSession, "closeAt">; budget: CallBudget; source: string },
    database: Database = db,
): Promise<{ rows: IntradayRow[]; claimed: string[] }> {
    if (!symbols.length) return { rows: [], claimed: [] };
    return database.transaction(async (tx) => {
        await tx.execute(INTRADAY_CLAIM_LOCK);
        const [used] = await buildRecentClaimsCountQuery(new Date(now.getTime() - budget.windowMs), tx);
        const rows = await buildIntradayRowsQuery([...symbols], tx);
        const claimed = chooseClaims(rows, budget.limit - Number(used?.count ?? 0), now, session);
        if (claimed.length) await buildClaimQuery(claimed, now, source, tx);
        return { rows, claimed };
    });
}

export async function saveIntradayResults(
    results: readonly IntradayResult[],
    { claimedAt, fetchedAt, source }: { claimedAt: Date; fetchedAt: Date; source: string },
    database: Database = db,
): Promise<void> {
    if (!results.length) return;
    await buildSaveResultsQuery(results, claimedAt, fetchedAt, source, database);
}

