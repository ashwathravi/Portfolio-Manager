/**
 * Nightly end-of-day price ingest (launch item i32), run as the daily job
 * "prices" by /api/cron/daily.
 *
 * 1. Track every symbol anyone holds, plus the benchmark ETFs. (Quote lookups
 *    track other symbols they are asked for, up to a limit; they are priced
 *    the same way.) A looked-up symbol that no daily file has priced within
 *    a week is dropped, so made-up tickers don't hold room under the limit.
 * 2. Catch up: store each trading day after the newest stored date, oldest
 *    first, from Massive's market-wide grouped daily bars (one call per day,
 *    cut down to the tracked symbols). At most five days a run, so a long
 *    gap closes over a few nights. A day that isn't published yet ends the
 *    catch-up; the next run picks it up.
 *    Before any of those days is stored, one call asks which stocks split on
 *    them: bars are split-adjusted, so a split puts every earlier stored bar
 *    of that stock on the old scale. Those stocks go back in the history
 *    queue before any day is stored, since the newest stored day is the next
 *    run's bookmark: a failed check or reset stores nothing, and the next run
 *    asks about the same days again.
 * 3. Backfill two years of history for symbols that don't have it yet, one
 *    aggregates call per symbol, while the run's time budget lasts: held
 *    symbols and benchmarks first, and a looked-up symbol only once a daily
 *    file has priced it (a made-up ticker never costs a call). A
 *    backfill replaces the symbol's stored bars up to that day; one with
 *    stored bars that gets no history back stays queued, so old-scale bars
 *    never stay beside new ones. The rest wait in the queue for the next run.
 *
 * The free Basic plan allows 5 calls a minute, so calls go through a pacer:
 * at most 5 in any 65-second window (a one-call-every-13-seconds pace once
 * the first five are spent), and none that couldn't finish within the budget.
 * The adapter makes no retries of its own, so every request is paced. A
 * rate-limit answer ends the run's provider calls without failing the job.
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
    type PolygonAdapterConfig,
    type SplitEvent,
} from "@/lib/providers/polygon-massive-adapter";
import type { OHLC } from "@/types/market-data";

import { getEasternParts, lastCompletedSession, nextTradingDay, previousTradingDay } from "./market-hours";
import {
    countSymbolsNeedingHistory,
    getLatestBarDate,
    hasStoredBars,
    listSymbolsNeedingHistory,
    listTrackedSymbols,
    markHistoryLoaded,
    normalizeSymbols,
    pruneUnpricedSecurities,
    replaceHistory,
    resetHistory,
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
/** How long a looked-up symbol may go without a bar before it stops being tracked. */
export const UNPRICED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** The adapter calls the ingest makes; PolygonMassiveAdapter in production. */
export interface PriceIngestAdapter {
    readonly isConfigured: boolean;
    getDailyBars(date: string): Promise<Map<string, DailyBar>>;
    getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]>;
    getSplits(from: string, to: string): Promise<SplitEvent[]>;
}

/** The database calls the ingest makes; the price store in production. */
export interface PriceIngestStore {
    listHeldSymbols(): Promise<string[]>;
    trackSecurities(symbols: Iterable<string>): Promise<string[]>;
    listTrackedSymbols(): Promise<Set<string>>;
    getLatestBarDate(): Promise<string | null>;
    upsertBars(bars: readonly PriceBarInput[]): Promise<{ stored: number; rejected: number }>;
    /** The backfill queue, `priority` symbols first. */
    listSymbolsNeedingHistory(limit: number, priority: readonly string[]): Promise<string[]>;
    countSymbolsNeedingHistory(priority: readonly string[]): Promise<number>;
    /** Drops never-priced securities tracked before `trackedBefore`, except `keep`. */
    pruneUnpricedSecurities(keep: readonly string[], trackedBefore: Date): Promise<string[]>;
    markHistoryLoaded(symbol: string, startDate: string): Promise<void>;
    /** Replaces a symbol's bars up to `through`; undefined when no bar is valid. */
    replaceHistory(
        symbol: string,
        bars: readonly PriceBarInput[],
        through: string,
    ): Promise<{ stored: number; rejected: number; historyStart: string } | undefined>;
    /** Puts loaded symbols back in the history queue; returns the ones reset. */
    resetHistory(symbols: string[]): Promise<string[]>;
    /** Whether any bar is stored for the symbol. */
    hasBars(symbol: string): Promise<boolean>;
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
    /** Looked-up symbols dropped for never being priced. */
    pruned?: string[];
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
    /**
     * The split check for this run's catch-up days: the tracked stocks that
     * split on them, put back in the history queue (`reset`) before any day
     * was stored, or why there was no check.
     */
    splits?: { from: string; to: string; reset: string[] } | { skipped: string };
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
        listSymbolsNeedingHistory: (limit, priority) => listSymbolsNeedingHistory(limit, priority, database),
        countSymbolsNeedingHistory: (priority) => countSymbolsNeedingHistory(priority, database),
        pruneUnpricedSecurities: (keep, trackedBefore) => pruneUnpricedSecurities(keep, trackedBefore, database),
        markHistoryLoaded: (symbol, startDate) => markHistoryLoaded(symbol, startDate, database),
        replaceHistory: (symbol, bars, through) => replaceHistory(symbol, bars, through, database),
        resetHistory: (symbols) => resetHistory(symbols, database),
        hasBars: (symbol) => hasStoredBars(symbol, database),
    };
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The ingest's Massive adapter. It makes no retries of its own: every
 * request must go through the pacer, and a 429 ends the run's provider calls
 * instead of being retried (and slept on) inside one.
 */
export function createIngestAdapter(config: Omit<PolygonAdapterConfig, "maxRetries"> = {}, apiKey?: string) {
    return new PolygonMassiveAdapter(apiKey, undefined, { ...config, maxRetries: 0 });
}

/**
 * Runs one nightly ingest and reports what it did. A provider or database
 * error during the catch-up fails the run (the job records it); a single
 * symbol's failed backfill is reported and leaves it queued for the next run.
 */
export async function ingestDailyPrices({
    adapter = createIngestAdapter(),
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
    const priority = normalizeSymbols([...held, ...BENCHMARK_SYMBOLS]);
    const newlyTracked = await store.trackSecurities(priority);
    const tracked = await store.listTrackedSymbols();

    // 2. Catch up on missed days, oldest first, asking about splits first.
    const latestBefore = await store.getLatestBarDate();
    const window = tradingDaysToIngest(latestBefore, session).slice(0, MAX_CATCH_UP_DAYS);
    let splitEvents: SplitEvent[] | undefined;
    let splitsSkipped: string | undefined;
    if (window.length === 0) {
        splitsSkipped = "up to date";
    } else if (latestBefore === null) {
        // Nothing stored yet, so no history on an old scale.
        splitsSkipped = "first run";
    } else if (!(await pacer.acquire())) {
        stopped.catchUp = "budget";
    } else {
        try {
            splitEvents = await adapter.getSplits(window[0], window.at(-1)!);
        } catch (error) {
            if (error instanceof PolygonRateLimitError) {
                stopped.catchUp = "rate-limited";
            } else if (error instanceof PolygonApiError && error.status === 403) {
                // Not on this plan. Prices still matter more than the check.
                splitsSkipped = summarizeError(error);
            } else {
                throw error;
            }
        }
    }

    // Re-queue every tracked stock that split in the window before storing any
    // day: the newest stored day is the next run's bookmark, so no day may be
    // stored while its split is unhandled. A split on a day that ends up not
    // stored (unpublished) costs at most one more history refetch.
    let splits: PriceIngestDetail["splits"];
    if (splitEvents) {
        const from = window[0];
        const to = window.at(-1)!;
        const split = normalizeSymbols(
            splitEvents.filter((event) => event.executionDate >= from && event.executionDate <= to).map((event) => event.symbol),
        ).filter((symbol) => tracked.has(symbol));
        splits = { from, to, reset: split.length > 0 ? await store.resetHistory(split) : [] };
    } else {
        splits = { skipped: splitsSkipped ?? stopped.catchUp ?? "no new days" };
    }

    const days: NonNullable<PriceIngestDetail["days"]> = [];
    for (const date of stopped.catchUp ? [] : window) {
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

    // Looked-up symbols no daily file has priced in a week (after the catch-up,
    // so one about to be priced isn't dropped) stop being tracked.
    const pruned = await store.pruneUnpricedSecurities(priority, new Date(now().getTime() - UNPRICED_GRACE_MS));

    // 3. Backfill history, up to the newest day the daily files have covered.
    // With nothing stored at all, the day before the session: the session
    // itself will come from its daily file.
    const historyThrough = latestAfter ?? previousTradingDay(session);
    const backfilled: NonNullable<PriceIngestDetail["backfilled"]> = [];
    const backfillErrors: NonNullable<PriceIngestDetail["backfillErrors"]> = [];
    if (stopped.catchUp === "rate-limited" || stopped.catchUp === "budget") {
        stopped.backfill = stopped.catchUp;
    } else {
        for (const symbol of await store.listSymbolsNeedingHistory(BACKFILL_BATCH, priority)) {
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
            const replaced = await store.replaceHistory(symbol, bars, historyThrough);
            if (!replaced && (await store.hasBars(symbol))) {
                // Stored bars that need replacing (a split, or a symbol first
                // priced today) but no history yet: it stays queued, so
                // old-scale bars never stay beside new ones. The next run asks again.
                backfillErrors.push({ symbol, error: "No history returned; still queued." });
                continue;
            }
            if (!replaced) {
                // Nothing to store (delisted, not a stock, or listed after
                // historyThrough). The history is marked as starting at
                // historyThrough, so the symbol leaves the queue and its bars
                // come from the daily files from then on.
                await store.markHistoryLoaded(symbol, historyThrough);
                backfilled.push({ symbol, stored: 0, rejected: bars.length, historyStart: historyThrough, empty: true });
                continue;
            }
            backfilled.push({ symbol, ...replaced });
        }
    }

    return {
        session,
        tracked: tracked.size,
        newlyTracked,
        pruned,
        days,
        daysBehind: tradingDaysToIngest(latestAfter, session).length,
        historyThrough,
        backfilled,
        backfillErrors,
        backfillQueue: await store.countSymbolsNeedingHistory(priority),
        splits,
        stopped,
        calls: pacer.calls,
    };
}
