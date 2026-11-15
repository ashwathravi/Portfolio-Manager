/**
 * Ticker search (launch item i35).
 *
 * Search reads a directory of listed US companies kept in Postgres
 * (symbol_directory), so typing never calls a market data provider: the
 * free Massive plan allows five calls a minute for the whole app. The
 * nightly job replaces the directory from SEC EDGAR's ticker file, one
 * request with no key.
 *
 * SEC's file lists companies and trusts (SPY, GLD, IBIT) but not most ETFs,
 * so a search also looks at the benchmark ETFs Atlas always tracks and at
 * what the user holds. Nothing else from the price store: the securities it
 * tracks because someone holds them would hint at what other people own. A
 * ticker found nowhere can still be typed.
 */

import { and, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdings, portfolios, securities, symbolDirectory } from "@/db/schema";
import { summarizeError } from "@/lib/jobs/runner";
import { reportError } from "@/lib/observability/report-error";
import { SecEdgarClient, type SecExchangeTicker } from "@/lib/sec/edgar-client";
import type { TickerMatch } from "@/types/market-data";

import { BENCHMARK_SYMBOLS } from "./price-ingest";
import { matchRank, parseTickerQuery, type TickerQuery } from "./ticker-search";

type Database = typeof db;

export interface DirectoryEntry {
    symbol: string;
    name: string;
    exchange: string | null;
    cik: string;
    /** The row's place in SEC's file, largest companies first. */
    position: number;
}

export const MAX_TICKER_MATCHES = 8;
/** Fewer usable tickers than this in SEC's file means a bad copy: the directory is kept. */
export const MIN_DIRECTORY_SIZE = 5_000;
const WRITE_CHUNK = 1_000;

/** Market identifier codes (Massive's primary_exchange) as people know them. */
const EXCHANGE_NAMES: Readonly<Record<string, string>> = {
    XNAS: "Nasdaq",
    XNYS: "NYSE",
    ARCX: "NYSE Arca",
    XASE: "NYSE American",
    BATS: "Cboe",
};

export function exchangeName(code: string | null | undefined): string | null {
    const trimmed = code?.trim();
    if (!trimmed) return null;
    return EXCHANGE_NAMES[trimmed.toUpperCase()] ?? trimmed;
}

/**
 * SEC's ticker as the app writes it, or null for one the directory leaves
 * out. Class shares become BRK.B (SEC writes BRK-B); preferreds, warrants
 * and units (BAC-PQ, UAC-WT, YCY-UN) are left out, since providers write
 * them differently and few people search for them.
 */
export function directoryTicker(secTicker: string): string | null {
    const ticker = secTicker.trim().toUpperCase();
    if (/^[A-Z]{1,5}$/.test(ticker)) return ticker;
    const classShare = /^([A-Z]{1,4})-([A-Z])$/.exec(ticker);
    return classShare ? `${classShare[1]}.${classShare[2]}` : null;
}

/** Drops SEC's state-of-incorporation suffix: "BANK OF AMERICA CORP /DE/". */
export function directoryName(name: string): string {
    return name.replace(/\s*\/[A-Z]{2,3}\/?\s*$/, "").trim();
}

/** The directory rows in SEC's file, first row per symbol kept, each with its place in the file. */
export function directoryEntries(tickers: readonly SecExchangeTicker[]): DirectoryEntry[] {
    const entries = new Map<string, DirectoryEntry>();
    tickers.forEach((row, position) => {
        const symbol = directoryTicker(row.ticker);
        const name = directoryName(row.name);
        if (!symbol || !name || entries.has(symbol)) return;
        entries.set(symbol, { symbol, name, exchange: row.exchange, cik: row.cik, position });
    });
    return [...entries.values()];
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const isListed = (exchange: string | null) => exchange !== null && exchange !== "OTC";

/** A match before ranking, with its place in SEC's file when it came from the directory. */
export type TickerCandidate = TickerMatch & { position?: number };

/**
 * The best `limit` matches, one per symbol: by rank, then the user's own
 * holdings, then listed before over-the-counter, then larger companies
 * (earlier in SEC's file), then shorter tickers. A held symbol that's also
 * in the directory keeps the directory's name and place.
 */
export function rankTickerMatches(candidates: readonly TickerCandidate[], query: TickerQuery, limit = MAX_TICKER_MATCHES): TickerMatch[] {
    const bySymbol = new Map<string, TickerCandidate>();
    for (const candidate of candidates) {
        const seen = bySymbol.get(candidate.symbol);
        if (!seen) {
            bySymbol.set(candidate.symbol, { ...candidate });
        } else {
            seen.held ||= candidate.held;
            seen.exchange ??= candidate.exchange;
            seen.position ??= candidate.position;
        }
    }
    return [...bySymbol.values()]
        .map((candidate) => ({ candidate, rank: matchRank(candidate, query) }))
        .filter((ranked): ranked is { candidate: TickerCandidate; rank: number } => ranked.rank !== null)
        .sort(({ candidate: a, rank: ra }, { candidate: b, rank: rb }) =>
            ra - rb
            || Number(b.held) - Number(a.held)
            || Number(isListed(b.exchange)) - Number(isListed(a.exchange))
            || (a.position ?? Infinity) - (b.position ?? Infinity)
            || a.symbol.length - b.symbol.length
            || a.symbol.localeCompare(b.symbol))
        .slice(0, limit)
        .map(({ candidate: { symbol, name, exchange, held } }) => ({ symbol, name, exchange, held }));
}

/** A LIKE pattern matching `value` literally (Postgres escapes with a backslash by default). */
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The directory's best matches, ranked as {@link matchRank} and {@link rankTickerMatches} do. */
export function buildDirectorySearchQuery(query: TickerQuery, limit: number, database: Pick<Database, "select"> = db) {
    const name = sql`lower(${symbolDirectory.name})`;
    const text = escapeLike(query.text);
    const symbolPrefix = query.symbol ? `${escapeLike(query.symbol)}%` : null;
    const symbolRanks = query.symbol && symbolPrefix
        ? sql`when ${symbolDirectory.symbol} = ${query.symbol} then 0 when ${symbolDirectory.symbol} like ${symbolPrefix} then 1`
        : sql``;
    const rank = sql`case ${symbolRanks}
        when ${name} like ${`${text}%`} then 2
        when ${name} like ${`% ${text}%`} then 3
        else 4 end`;
    return database
        .select({
            symbol: symbolDirectory.symbol,
            name: symbolDirectory.name,
            exchange: symbolDirectory.exchange,
            position: symbolDirectory.position,
        })
        .from(symbolDirectory)
        .where(or(
            symbolPrefix ? like(symbolDirectory.symbol, symbolPrefix) : undefined,
            sql`${name} like ${`%${text}%`}`,
        ))
        .orderBy(
            rank,
            sql`(${symbolDirectory.exchange} is null or ${symbolDirectory.exchange} = 'OTC')`,
            symbolDirectory.position,
            sql`length(${symbolDirectory.symbol})`,
            symbolDirectory.symbol,
        )
        .limit(limit);
}

/**
 * The symbols the user holds in any of their accounts, each with its
 * directory row when it has one. The directory's name is the one a company
 * search matches: a holding imported without a description is named by its
 * ticker, and the directory's own best matches may not reach it.
 */
export function buildHeldSymbolsQuery(userId: string, database: Pick<Database, "selectDistinct"> = db) {
    return database
        .selectDistinct({
            symbol: holdings.symbol,
            name: holdings.name,
            directoryName: symbolDirectory.name,
            exchange: symbolDirectory.exchange,
            position: symbolDirectory.position,
        })
        .from(holdings)
        .innerJoin(portfolios, eq(portfolios.id, holdings.portfolioId))
        .leftJoin(symbolDirectory, eq(symbolDirectory.symbol, sql`upper(${holdings.symbol})`))
        .where(eq(portfolios.userId, userId));
}

/** The benchmark ETFs' reference data, which every user's pages already use. */
export function buildBenchmarkSymbolsQuery(database: Pick<Database, "select"> = db) {
    return database
        .select({ symbol: securities.symbol, name: securities.name, exchange: securities.primaryExchange })
        .from(securities)
        .where(and(inArray(securities.symbol, [...BENCHMARK_SYMBOLS]), isNotNull(securities.name)));
}

export async function searchTickers(
    raw: string,
    { userId, limit = MAX_TICKER_MATCHES, database = db }: { userId: string; limit?: number; database?: Database },
): Promise<TickerMatch[]> {
    const query = parseTickerQuery(raw);
    if (!query) return [];
    const [directory, held, benchmarks] = await Promise.all([
        buildDirectorySearchQuery(query, limit, database),
        buildHeldSymbolsQuery(userId, database),
        buildBenchmarkSymbolsQuery(database),
    ]);
    return rankTickerMatches([
        ...directory.map((row) => ({ ...row, held: false })),
        ...held.map((row) => ({
            symbol: row.symbol.toUpperCase(),
            name: row.directoryName ?? (row.name || row.symbol),
            exchange: row.exchange,
            held: true,
            position: row.position ?? undefined,
        })),
        ...benchmarks.map((row) => ({ symbol: row.symbol, name: row.name ?? row.symbol, exchange: exchangeName(row.exchange), held: false })),
    ], query, limit);
}

// ---------------------------------------------------------------------------
// Nightly refresh
// ---------------------------------------------------------------------------

export interface DirectoryRefreshDetail {
    /** Tickers in the directory after the refresh. */
    entries?: number;
    /** New since the last refresh (listings, new tickers). */
    added?: number;
    /** No longer in SEC's file (delisted, renamed). */
    removed?: number;
    /** Why the directory was left as it was. */
    error?: string;
}

/** Adds the entries, rewriting only those that differ. */
export function buildUpsertDirectoryQuery(entries: readonly DirectoryEntry[], at: Date, database: Pick<Database, "insert"> = db) {
    return database
        .insert(symbolDirectory)
        .values(entries.map((entry) => ({ ...entry, updatedAt: at })))
        .onConflictDoUpdate({
            target: symbolDirectory.symbol,
            set: {
                name: sql`excluded.name`,
                exchange: sql`excluded.exchange`,
                cik: sql`excluded.cik`,
                position: sql`excluded.position`,
                updatedAt: at,
            },
            setWhere: sql`(${symbolDirectory.name}, ${symbolDirectory.exchange}, ${symbolDirectory.cik}, ${symbolDirectory.position})
                is distinct from (excluded.name, excluded.exchange, excluded.cik, excluded.position)`,
        });
}

/** Replaces the directory with `entries` in one transaction. */
export async function replaceDirectory(entries: readonly DirectoryEntry[], at: Date, database: Database = db) {
    return database.transaction(async (tx) => {
        const before = new Set((await tx.select({ symbol: symbolDirectory.symbol }).from(symbolDirectory)).map((row) => row.symbol));
        for (let i = 0; i < entries.length; i += WRITE_CHUNK) {
            await buildUpsertDirectoryQuery(entries.slice(i, i + WRITE_CHUNK), at, tx);
        }
        const keep = new Set(entries.map((entry) => entry.symbol));
        const gone = [...before].filter((symbol) => !keep.has(symbol));
        for (let i = 0; i < gone.length; i += WRITE_CHUNK) {
            await tx.delete(symbolDirectory).where(inArray(symbolDirectory.symbol, gone.slice(i, i + WRITE_CHUNK)));
        }
        return { added: entries.filter((entry) => !before.has(entry.symbol)).length, removed: gone.length };
    });
}

/**
 * Replaces the directory from SEC's ticker file. Never throws: a failed
 * fetch, or a file too short to be whole, keeps yesterday's directory and
 * says why, so the price job that runs it carries on.
 */
export async function refreshSymbolDirectory({
    fetchTickers = () => new SecEdgarClient({ maxRetries: 0 }).fetchExchangeTickers(),
    database = db,
    now = () => new Date(),
}: {
    fetchTickers?: () => Promise<SecExchangeTicker[]>;
    database?: Database;
    now?: () => Date;
} = {}): Promise<DirectoryRefreshDetail> {
    try {
        const entries = directoryEntries(await fetchTickers());
        if (entries.length < MIN_DIRECTORY_SIZE) {
            return { error: `SEC's ticker file had ${entries.length} usable tickers; the directory was kept.` };
        }
        const { added, removed } = await replaceDirectory(entries, now(), database);
        return { entries: entries.length, added, removed };
    } catch (error) {
        reportError(error, { tags: { job: "prices", step: "symbol-directory" } });
        return { error: summarizeError(error) };
    }
}
