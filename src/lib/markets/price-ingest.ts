/**
 * Nightly end-of-day price ingest (launch item i32), run as the daily job
 * "prices" by /api/cron/daily.
 *
 * 1. Track every symbol anyone holds, plus the benchmark ETFs. (Quotes track
 *    any other symbol they are asked for; it is priced the same way.)
 * 2. Catch up: store each trading day after the newest stored date, oldest
 *    first, from Massive's market-wide grouped daily bars (one call per day,
 *    cut down to the tracked symbols). At most five days a run, so a long
 *    gap closes over a few nights. A day that isn't published yet ends the
 *    catch-up; the next run picks it up.
 * 3. Backfill two years of history for symbols that don't have it yet, one
 *    aggregates call per symbol, while the run's time budget lasts. The rest
 *    wait in the queue for the next run.
 *
 * The free Basic plan allows 5 calls a minute, so calls go through a pacer:
 * at most 5 in any 65-second window (a one-call-every-13-seconds pace once
 * the first five are spent), and none that couldn't finish within the budget.
 * A rate-limit answer ends the run's provider calls without failing the job.
 *
 * The newest date in price_bars is the catch-up's bookmark, so it must only
 * ever be a day whose market-wide file was stored. A backfill therefore keeps
 * a symbol's history only up to that day; later days come from the daily
 * files.
 */

import { db } from "@/db";
import { holdings } from "@/db/schema";
import { summarizeError } from "@/lib/jobs/runner";
import {
    PolygonApiError,
    PolygonMassiveAdapter,
    PolygonRateLimitError,
    type DailyBar,
} from "@/lib/providers/polygon-massive-adapter";
import type { OHLC } from "@/types/market-data";

import { getEasternParts, lastCompletedSession, nextTradingDay, previousTradingDay } from "./market-hours";
import {
    countSymbolsNeedingHistory,
    getLatestBarDate,
    isValidBar,
    listSymbolsNeedingHistory,
    listTrackedSymbols,
    markHistoryLoaded,
    selectTrackedBars,
    trackSecurities,
    upsertBars,
    type PriceBarInput,
} from "./price-store";

type Database = typeof db;

/** Broad market and the eleven SPDR sector ETFs: what returns are measured against. */
export const BENCHMARK_SYMBOLS = [
    "SPY", "QQQ", "DIA", "IWM",
    "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
] as const;

export const PRICE_SOURCE = "massive";
export const MAX_CATCH_UP_DAYS = 5;
/** The free plan keeps two years of daily history. */
export const HISTORY_RANGE = "2Y";
/** Under Vercel's 300-second function limit, with room for the last call. */
export const DEFAULT_BUDGET_MS = 240_000;
/** Free plan: 5 calls a minute. The window has 5 s of slack for clock drift. */
export const CALLS_PER_WINDOW = 5;
export const CALL_WINDOW_MS = 65_000;
/** Time left for a call to finish once started: the adapter's request timeout. */
export const CALL_ALLOWANCE_MS = 10_000;
/** More symbols than one run's budget can fetch, so the budget is what stops it. */
const BACKFILL_BATCH = 50;

/** The adapter calls the ingest makes; PolygonMassiveAdapter in production. */
export interface PriceIngestAdapter {
    readonly isConfigured: boolean;
    getDailyBars(date: string): Promise<Map<string, DailyBar>>;
    getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]>;
}

/** The database calls the ingest makes; the price store in production. */
export interface PriceIngestStore {
    listHeldSymbols(): Promise<string[]>;
    trackSecurities(symbols: Iterable<string>): Promise<string[]>;
    listTrackedSymbols(): Promise<Set<string>>;
    getLatestBarDate(): Promise<string | null>;
    upsertBars(bars: readonly PriceBarInput[]): Promise<{ stored: number; rejected: number }>;
    listSymbolsNeedingHistory(limit: number): Promise<string[]>;
    countSymbolsNeedingHistory(): Promise<number>;
    markHistoryLoaded(symbol: string, startDate: string): Promise<void>;
}

export interface IngestPricesOptions {
    adapter?: PriceIngestAdapter;
    now?: () => Date;
    /** Database for the default store. */
    database?: Database;
    /** Replaces the price store entirely (tests). */
    store?: PriceIngestStore;
    sleep?: (ms: number) => Promise<void>;
    budgetMs?: number;
}

/** Why a phase ended before its work was done. */
export type IngestStopReason = "not-published" | "budget" | "rate-limited";

export type PriceIngestDetail = {
    /** Why the run did nothing, e.g. no API key. Absent on a normal run. */
    skipped?: string;
    /** The last completed session when the run started: what it catches up to. */
    session?: string;
    tracked?: number;
    newlyTracked?: string[];
    /** Days stored from the market-wide daily files, oldest first. */
    days?: Array<{ date: string; stored: number; rejected: number }>;
    /** Trading days still to store after this run; 0 when up to date. */
    daysBehind?: number;
    /** Histories end on this day; later days come from the daily files. */
    historyThrough?: string;
    backfilled?: Array<{ symbol: string; stored: number; rejected: number; historyStart: string; empty?: true }>;
    backfillErrors?: Array<{ symbol: string; error: string }>;
    /** Symbols still waiting for history after this run. */
    backfillQueue?: number;
    stopped?: { catchUp?: IngestStopReason; backfill?: IngestStopReason };
    /** Provider calls made. */
    calls?: number;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Trading days after `after` up to and including `through`, oldest first.
 * With nothing stored yet (`after` null) only `through` itself: the history
 * backfill supplies the days before it.
 */
export function tradingDaysToIngest(after: string | null, through: string): string[] {
    if (after === null) return [through];
    const days: string[] = [];
    for (let day = nextTradingDay(after); day <= through; day = nextTradingDay(day)) days.push(day);
    return days;
}

/**
 * Converts a provider history to bars keyed by Eastern trading date. Massive
 * stamps a daily bar with midnight New York time (04:00Z in summer, 05:00Z in
 * winter), so the UTC date would usually match, but the Eastern date is the
 * one that is always right. Bars after `through` are dropped.
 */
export function historyToBars(symbol: string, history: readonly OHLC[], through: string): PriceBarInput[] {
    return history.flatMap((bar) => {
        const time = new Date(bar.timestamp);
        if (Number.isNaN(time.getTime())) return [];
        const date = getEasternParts(time).date;
        if (date > through) return [];
        return [{
            symbol,
            date,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            source: PRICE_SOURCE,
        }];
    });
}

/** How long to wait before the next call so it is at most the `limit`th in any window. */
export function pacingDelay(callTimes: readonly number[], at: number, limit: number, windowMs: number): number {
    if (callTimes.length < limit) return 0;
    return Math.max(0, callTimes[callTimes.length - limit] + windowMs - at);
}

/**
 * Hands out provider calls: waits (with the injected sleep) until a call fits
 * the rate limit, and refuses one that couldn't finish before the deadline.
 */
export function createCallPacer({
    now,
    sleep,
    deadline,
    limit = CALLS_PER_WINDOW,
    windowMs = CALL_WINDOW_MS,
    allowanceMs = CALL_ALLOWANCE_MS,
}: {
    now: () => Date;
    sleep: (ms: number) => Promise<void>;
    deadline: number;
    limit?: number;
    windowMs?: number;
    allowanceMs?: number;
}) {
    const calls: number[] = [];
    return {
        get calls() {
            return calls.length;
        },
        async acquire(): Promise<boolean> {
            const at = now().getTime();
            const wait = pacingDelay(calls, at, limit, windowMs);
            if (at + wait + allowanceMs > deadline) return false;
            if (wait > 0) await sleep(wait);
            calls.push(now().getTime());
            return true;
        },
    };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/**
 * Every distinct symbol in anyone's holdings. Deliberately not scoped to a
 * user: it decides which market data to keep, and returns no user data.
 */
export function buildHeldSymbolsQuery(database: Database = db) {
    return database.selectDistinct({ symbol: holdings.symbol }).from(holdings);
}

export function createPriceIngestStore(database: Database = db): PriceIngestStore {
    return {
        listHeldSymbols: async () => (await buildHeldSymbolsQuery(database)).map((row) => row.symbol),
        trackSecurities: (symbols) => trackSecurities(symbols, database),
        listTrackedSymbols: () => listTrackedSymbols(database),
        getLatestBarDate: () => getLatestBarDate(database),
        upsertBars: (bars) => upsertBars(bars, database),
        listSymbolsNeedingHistory: (limit) => listSymbolsNeedingHistory(limit, database),
        countSymbolsNeedingHistory: () => countSymbolsNeedingHistory(database),
        markHistoryLoaded: (symbol, startDate) => markHistoryLoaded(symbol, startDate, database),
    };
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs one nightly ingest and reports what it did. A provider or database
 * error during the catch-up fails the run (the job records it); a single
 * symbol's failed backfill is reported and leaves it queued for the next run.
 */
export async function ingestDailyPrices({
    adapter = new PolygonMassiveAdapter(),
    now = () => new Date(),
    database = db,
    store = createPriceIngestStore(database),
    sleep = defaultSleep,
    budgetMs = DEFAULT_BUDGET_MS,
}: IngestPricesOptions = {}): Promise<PriceIngestDetail> {
    if (!adapter.isConfigured) {
        return { skipped: "Market data is not configured: POLYGON_API_KEY is not set." };
    }

    const pacer = createCallPacer({ now, sleep, deadline: now().getTime() + budgetMs });
    const session = lastCompletedSession(now());
    const stopped: NonNullable<PriceIngestDetail["stopped"]> = {};

    // 1. Track what anyone holds, plus the benchmarks.
    const held = await store.listHeldSymbols();
    const newlyTracked = await store.trackSecurities([...BENCHMARK_SYMBOLS, ...held]);
    const tracked = await store.listTrackedSymbols();

    // 2. Catch up on missed days, oldest first.
    const latestBefore = await store.getLatestBarDate();
    const pending = tradingDaysToIngest(latestBefore, session);
    const days: NonNullable<PriceIngestDetail["days"]> = [];
    for (const date of pending.slice(0, MAX_CATCH_UP_DAYS)) {
        if (!(await pacer.acquire())) {
            stopped.catchUp = "budget";
            break;
        }
        let daily: Map<string, DailyBar>;
        try {
            daily = await adapter.getDailyBars(date);
        } catch (error) {
            if (error instanceof PolygonRateLimitError) {
                stopped.catchUp = "rate-limited";
                break;
            }
            throw error;
        }
        if (daily.size === 0) {
            stopped.catchUp = "not-published";
            break;
        }
        const bars = selectTrackedBars([...daily.values()].map((bar) => ({ ...bar, source: PRICE_SOURCE })), tracked);
        days.push({ date, ...(await store.upsertBars(bars)) });
    }
    const latestAfter = days.at(-1)?.date ?? latestBefore;

    // 3. Backfill history, up to the newest day the daily files have covered.
    // With nothing stored at all, the day before the session: the session
    // itself will come from its daily file.
    const historyThrough = latestAfter ?? previousTradingDay(session);
    const backfilled: NonNullable<PriceIngestDetail["backfilled"]> = [];
    const backfillErrors: NonNullable<PriceIngestDetail["backfillErrors"]> = [];
    if (stopped.catchUp === "rate-limited" || stopped.catchUp === "budget") {
        stopped.backfill = stopped.catchUp;
    } else {
        for (const symbol of await store.listSymbolsNeedingHistory(BACKFILL_BATCH)) {
            if (!(await pacer.acquire())) {
                stopped.backfill = "budget";
                break;
            }
            let history: OHLC[];
            try {
                history = await adapter.getHistoricalPrices(symbol, HISTORY_RANGE);
            } catch (error) {
                if (error instanceof PolygonRateLimitError) {
                    stopped.backfill = "rate-limited";
                    break;
                }
                if (error instanceof PolygonApiError && error.status === 404) {
                    history = [];
                } else {
                    backfillErrors.push({ symbol, error: summarizeError(error) });
                    continue;
                }
            }

            const bars = historyToBars(symbol, history, historyThrough);
            const valid = bars.filter(isValidBar);
            if (valid.length === 0) {
                // Nothing to store (delisted, not a stock, or listed after
                // historyThrough). The history is marked as starting at
                // historyThrough, so the symbol leaves the queue and its bars
                // come from the daily files from then on.
                await store.markHistoryLoaded(symbol, historyThrough);
                backfilled.push({ symbol, stored: 0, rejected: bars.length, historyStart: historyThrough, empty: true });
                continue;
            }
            const result = await store.upsertBars(bars);
            const historyStart = valid.reduce((earliest, bar) => (bar.date < earliest ? bar.date : earliest), valid[0].date);
            await store.markHistoryLoaded(symbol, historyStart);
            backfilled.push({ symbol, ...result, historyStart });
        }
    }

    return {
        session,
        tracked: tracked.size,
        newlyTracked,
        days,
        daysBehind: tradingDaysToIngest(latestAfter, session).length,
        historyThrough,
        backfilled,
        backfillErrors,
        backfillQueue: await store.countSymbolsNeedingHistory(),
        stopped,
        calls: pacer.calls,
    };
}
