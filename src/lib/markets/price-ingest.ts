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
 *    gap closes over a few nights. An empty file followed by a published
 *    one was a day the market closed after all (one the calendar doesn't
 *    know); it is recorded as closed and passed. An empty file with nothing
 *    published after it isn't out yet and ends the catch-up; the next run
 *    picks it up.
 *    Before any of those days is stored, one call asks which stocks split on
 *    them: bars are split-adjusted, so a split puts every earlier stored bar
 *    of that stock on the old scale. Those bars are deleted and the stocks go
 *    back in the history queue before any day is stored, since the newest
 *    stored day is the next run's bookmark: a failed check or reset stores
 *    nothing, and the next run asks about the same days again.
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
 * The adapter makes no retries of its own, so every request is paced, and
 * each request also takes a token from the Massive budget shared with the
 * app's own history, fundamentals and search requests (massive-quota.ts). A
 * rate-limit answer (that budget spent, or Massive's own 429) is waited out
 * and the call made again; only a wait that would overrun the time budget
 * ends the run's provider calls, without failing the job.
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
    adjustHoldingsForSplit,
    listHeldSince,
    reconcileHoldingSplits,
    type HoldingSplit,
    type HoldingSplitOutcome,
} from "@/lib/portfolio/split-adjustments";
import { getMassiveQuota } from "@/lib/providers/massive-quota";
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
    clearSplitHistories,
    countSymbolsNeedingHistory,
    getLatestBarDate,
    hasStoredBars,
    isValidBar,
    listSymbolsNeedingHistory,
    listTrackedSymbols,
    markHistoryAttempted,
    markHistoryLoaded,
    normalizeSymbols,
    pruneUnpricedSecurities,
    replaceHistory,
    resetHistory,
    resetUnpricedHistories,
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
/** The least wait after a rate limit: a 429 without Retry-After says nothing useful. */
export const RATE_LIMIT_WAIT_MS = 15_000;
/** More symbols than one run's budget can fetch, so the budget is what stops it. */
const BACKFILL_BATCH = 50;
/** Held tickers per holdings-split request (they go in the URL). */
const HOLDING_SPLITS_BATCH = 200;
/** How long a looked-up symbol may go without a bar before it stops being tracked. */
export const UNPRICED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** The adapter calls the ingest makes; PolygonMassiveAdapter in production. */
export interface PriceIngestAdapter {
    readonly isConfigured: boolean;
    getDailyBars(date: string): Promise<Map<string, DailyBar>>;
    /** Daily bars, and how many provider rows couldn't be read (see PolygonMassiveAdapter.getDailyHistory). */
    getDailyHistory(symbol: string, range: string): Promise<{ bars: OHLC[]; unreadable: number }>;
    /** Splits between two dates, all stocks or only `tickers`. */
    getSplits(from: string, to: string, tickers?: readonly string[]): Promise<SplitEvent[]>;
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
    /**
     * Replaces a symbol's bars from a fetched history; undefined when no bar
     * is valid. `complete` false: stored bars lie beyond the history's last
     * day, so it stays queued.
     */
    replaceHistory(
        symbol: string,
        bars: readonly PriceBarInput[],
        through: string,
        unreadable: number,
    ): Promise<{ stored: number; rejected: number; historyStart: string; complete: boolean } | undefined>;
    /** Records an attempt that left the symbol queued, so retries rotate. */
    markHistoryAttempted(symbol: string, at: Date): Promise<void>;
    /** Puts loaded symbols back in the history queue; returns the ones reset. */
    resetHistory(symbols: string[]): Promise<string[]>;
    /** Stocks that split: deletes their (old-scale) bars and re-queues them; returns those cleared. */
    clearSplitHistories(symbols: string[]): Promise<string[]>;
    /** Moves held positions to the post-split share count; returns how many were adjusted. */
    adjustHoldingsForSplit(split: HoldingSplit): Promise<number>;
    /** Each held stock and when its least recently updated position last changed. */
    listHeldSince(): Promise<Array<{ symbol: string; since: Date }>>;
    /** Whether any bar is stored for the symbol. */
    hasBars(symbol: string): Promise<boolean>;
    /** Re-queues loaded symbols with no bar at all (an empty backfill); returns those re-queued. */
    resetUnpricedHistories(symbols: string[]): Promise<string[]>;
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
    /**
     * Days stored from the market-wide daily files, oldest first. `requeued`:
     * symbols whose history goes back in the queue before the day is stored,
     * because the day's bar for them was invalid, or because it is their
     * first bar after an empty backfill.
     */
    days?: Array<{ date: string; stored: number; rejected: number; requeued?: string[]; closed?: true }>;
    /** Trading days still to store after this run; 0 when up to date. */
    daysBehind?: number;
    /** Histories end on this day; later days come from the daily files. */
    historyThrough?: string;
    /** `complete` false: stored bars lie beyond the history, so it stays queued. */
    backfilled?: Array<{ symbol: string; stored: number; rejected: number; historyStart: string; complete?: boolean; empty?: true }>;
    backfillErrors?: Array<{ symbol: string; error: string }>;
    /** Symbols still waiting for history after this run. */
    backfillQueue?: number;
    /**
     * The split check for this run's catch-up days: the tracked stocks that
     * split on them, put back in the history queue (`reset`) before any day
     * was stored, or why there was no check.
     */
    splits?: { from: string; to: string; reset: string[] } | { skipped: string };
    /**
     * Held positions moved to the post-split share count, from every split
     * since each held stock's oldest position was last updated (`adjusted`),
     * and held stocks with a split that couldn't be applied safely
     * (`unadjusted`: re-import those), or why there was no check.
     */
    holdingSplits?: ({ from: string; to: string } & Partial<HoldingSplitOutcome>) | { skipped: string };
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
        /** Waits `ms` if a call could still start and finish after it. */
        async wait(ms: number): Promise<boolean> {
            if (now().getTime() + ms + allowanceMs > deadline) return false;
            await sleep(ms);
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
        markHistoryAttempted: (symbol, at) => markHistoryAttempted(symbol, at, database),
        replaceHistory: (symbol, bars, through, unreadable) => replaceHistory(symbol, bars, through, { unreadable }, database),
        resetHistory: (symbols) => resetHistory(symbols, database),
        clearSplitHistories: (symbols) => clearSplitHistories(symbols, database),
        adjustHoldingsForSplit: (split) => adjustHoldingsForSplit(split, database),
        listHeldSince: () => listHeldSince(database),
        hasBars: (symbol) => hasStoredBars(symbol, database),
        resetUnpricedHistories: (symbols) => resetUnpricedHistories(symbols, database),
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
    return new PolygonMassiveAdapter(apiKey, undefined, {
        quota: getMassiveQuota(),
        ...config,
        maxRetries: 0,
    });
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
    /**
     * One provider call through the pacer. A rate limit is waited out (at
     * least RATE_LIMIT_WAIT_MS) and the call made again, while the budget
     * lasts; other errors are the caller's.
     */
    const paced = async <T>(request: () => Promise<T>): Promise<{ value: T } | { stopped: IngestStopReason }> => {
        for (;;) {
            if (!(await pacer.acquire())) return { stopped: "budget" };
            try {
                return { value: await request() };
            } catch (error) {
                if (!(error instanceof PolygonRateLimitError)) throw error;
                if (!(await pacer.wait(Math.max(error.retryAfterMs, RATE_LIMIT_WAIT_MS)))) return { stopped: "rate-limited" };
            }
        }
    };
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
    } else {
        // Asked on the first run too: nothing stored is on an old scale yet,
        // but a split on that first session still moves held positions.
        // Any refusal fails the run before a day is stored (403 included: the
        // endpoint is on every Stocks plan, so a 403 is a key or plan problem
        // to fix, not a reason to store days whose splits went unchecked).
        const answer = await paced(() => adapter.getSplits(window[0], window.at(-1)!));
        if ("stopped" in answer) stopped.catchUp = answer.stopped;
        else splitEvents = answer.value;
    }

    // Clear every tracked stock that split in the window before storing any
    // day: the newest stored day is the next run's bookmark, so no day may be
    // stored while its split is unhandled. Every bar stored so far predates
    // the window, so it is on the old scale: all of them go, and the stock is
    // re-queued, so a post-split bar is never shown beside them. A split on
    // a day that ends up not stored (unpublished) costs at most one more
    // history refetch.
    let splits: PriceIngestDetail["splits"];
    if (splitEvents) {
        const from = window[0];
        const to = window.at(-1)!;
        const split = normalizeSymbols(
            splitEvents.filter((event) => event.executionDate >= from && event.executionDate <= to).map((event) => event.symbol),
        ).filter((symbol) => tracked.has(symbol));
        splits = { from, to, reset: split.length > 0 ? await store.clearSplitHistories(split) : [] };
    } else {
        splits = { skipped: splitsSkipped ?? stopped.catchUp ?? "no new days" };
    }

    const days: NonNullable<PriceIngestDetail["days"]> = [];
    /** Empty days not yet known to be closures: one with a published day after it was. */
    let empty: string[] = [];
    for (const date of stopped.catchUp ? [] : window) {
        const answer = await paced(() => adapter.getDailyBars(date));
        if ("stopped" in answer) {
            stopped.catchUp = answer.stopped;
            break;
        }
        const daily: Map<string, DailyBar> = answer.value;
        if (daily.size === 0) {
            empty.push(date);
            continue;
        }
        // A later session is published, so the empty days before it were
        // closures the calendar didn't know. Storing this day moves the
        // bookmark past them.
        for (const closed of empty) days.push({ date: closed, stored: 0, rejected: 0, closed: true });
        empty = [];
        const bars = selectTrackedBars([...daily.values()].map((bar) => ({ ...bar, source: PRICE_SOURCE })), tracked);
        // Before the day is stored (it becomes the bookmark, so it is never
        // read again): a tracked bar it can't store is recovered through the
        // symbol's history, and a symbol priced for the first time after an
        // empty backfill has its history asked for again.
        const rejected = normalizeSymbols(bars.filter((bar) => !isValidBar(bar)).map((bar) => bar.symbol));
        const priced = bars.filter(isValidBar).map((bar) => bar.symbol);
        const requeued = [
            ...(rejected.length > 0 ? await store.resetHistory(rejected) : []),
            ...(priced.length > 0 ? await store.resetUnpricedHistories(priced) : []),
        ];
        days.push({ date, ...(await store.upsertBars(bars)), ...(requeued.length > 0 ? { requeued } : {}) });
    }
    // Empty days with nothing published after them aren't out yet.
    if (empty.length > 0 && !stopped.catchUp) stopped.catchUp = "not-published";
    const latestAfter = days.findLast((day) => !day.closed)?.date ?? latestBefore;

    // Held positions after splits, separate from the price bookmark: every
    // split since each held stock's oldest position was last updated, so a
    // position imported before a split the catch-up never saw (before the
    // first run, say) is adjusted too. Applying a split is safe to repeat
    // (split-adjustments.ts), so the same splits are simply seen again each
    // run. A failure is reported, not fatal: prices don't depend on it.
    let holdingSplits: PriceIngestDetail["holdingSplits"];
    const heldSince = await store.listHeldSince();
    if (heldSince.length === 0) {
        holdingSplits = { skipped: "nothing held" };
    } else if (stopped.catchUp === "rate-limited" || stopped.catchUp === "budget") {
        holdingSplits = { skipped: stopped.catchUp };
    } else {
        const from = heldSince.map(({ since }) => getEasternParts(since).date).sort()[0];
        const symbols = normalizeSymbols(heldSince.map(({ symbol }) => symbol)).sort();
        if (from > session) {
            holdingSplits = { skipped: "up to date" };
        } else {
            const events: SplitEvent[] = [];
            let failed: string | undefined;
            for (let start = 0; start < symbols.length && !failed; start += HOLDING_SPLITS_BATCH) {
                const batch = symbols.slice(start, start + HOLDING_SPLITS_BATCH);
                try {
                    const answer = await paced(() => adapter.getSplits(from, session, batch));
                    if ("stopped" in answer) failed = answer.stopped;
                    else events.push(...answer.value);
                } catch (error) {
                    failed = summarizeError(error);
                }
            }
            if (failed) {
                holdingSplits = { skipped: failed };
            } else {
                const outcome = await reconcileHoldingSplits(events, new Set(symbols), (split) => store.adjustHoldingsForSplit(split));
                holdingSplits = {
                    from,
                    to: session,
                    ...(outcome.adjusted.length > 0 ? { adjusted: outcome.adjusted } : {}),
                    ...(outcome.unadjusted.length > 0 ? { unadjusted: outcome.unadjusted } : {}),
                };
            }
        }
    }

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
            let history: OHLC[];
            let unreadable = 0;
            try {
                const answer = await paced(() => adapter.getDailyHistory(symbol, HISTORY_RANGE));
                if ("stopped" in answer) {
                    stopped.backfill = answer.stopped;
                    break;
                }
                ({ bars: history, unreadable } = answer.value);
            } catch (error) {
                if (error instanceof PolygonApiError && error.status === 404) {
                    history = [];
                } else {
                    backfillErrors.push({ symbol, error: summarizeError(error) });
                    await store.markHistoryAttempted(symbol, now());
                    continue;
                }
            }

            const bars = historyToBars(symbol, history, historyThrough);
            const replaced = await store.replaceHistory(symbol, bars, historyThrough, unreadable);
            if (!replaced && (await store.hasBars(symbol))) {
                // Stored bars that need replacing (a split, or a symbol first
                // priced today) but no history yet: it stays queued, so
                // old-scale bars never stay beside new ones. The next run asks again.
                backfillErrors.push({ symbol, error: "No history returned; still queued." });
                await store.markHistoryAttempted(symbol, now());
                continue;
            }
            if (!replaced) {
                // Nothing to store (delisted, not a stock, or listed after
                // historyThrough). The history is marked as starting at
                // historyThrough, so the symbol leaves the queue and its bars
                // come from the daily files from then on; the first daily
                // file that prices it puts it back in the queue once more.
                await store.markHistoryLoaded(symbol, historyThrough);
                backfilled.push({ symbol, stored: 0, rejected: bars.length, historyStart: historyThrough, empty: true });
                continue;
            }
            const { complete, ...result } = replaced;
            if (complete) {
                backfilled.push({ symbol, ...result });
            } else {
                // The history doesn't cover bars already stored (it lags the
                // daily files: those could be on the old scale), or it is
                // missing sessions (unreadable or rejected rows): the symbol
                // stays queued until a complete history comes back.
                await store.markHistoryAttempted(symbol, now());
                backfilled.push({ symbol, ...result, complete: false });
            }
        }
    }

    return {
        session,
        tracked: tracked.size,
        newlyTracked,
        pruned,
        holdingSplits,
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
