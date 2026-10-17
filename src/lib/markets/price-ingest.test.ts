import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    PolygonApiError,
    PolygonRateLimitError,
    type DailyBar,
    type SplitEvent,
} from "@/lib/providers/polygon-massive-adapter";
import type { HoldingSplit } from "@/lib/portfolio/split-adjustments";
import type { OHLC } from "@/types/market-data";

import {
    BENCHMARK_SYMBOLS,
    buildHeldSymbolsQuery,
    createCallPacer,
    createIngestAdapter,
    historyToBars,
    ingestDailyPrices,
    pacingDelay,
    tradingDaysToIngest,
    type PriceIngestAdapter,
    type PriceIngestStore,
} from "./price-ingest";
import { dedupeBars, isValidBar, normalizeSymbols, type PriceBarInput } from "./price-store";

// Friday 16 October 2026, 6:30 PM EDT: the cron's usual time, after the close.
const FRIDAY_EVENING = "2026-10-16T22:30:00.000Z";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeClock(start = FRIDAY_EVENING) {
    let current = Date.parse(start);
    const sleeps: number[] = [];
    return {
        now: () => new Date(current),
        sleep: async (ms: number) => {
            sleeps.push(ms);
            current += ms;
        },
        advance: (ms: number) => {
            current += ms;
        },
        sleeps,
    };
}

function dailyBar(symbol: string, date: string, close = 100): DailyBar {
    return { symbol, date, open: close, high: close + 1, low: close - 1, close, volume: 1_000 };
}

function ohlc(timestamp: string, close = 100): OHLC {
    return { timestamp, open: close, high: close + 1, low: close - 1, close, volume: 1_000 };
}

function fakeAdapter({
    configured = true,
    daily = {},
    history = {},
    unreadable = {},
    splits = [],
    rateLimitedOnce = [],
    onCall,
}: {
    configured?: boolean;
    daily?: Record<string, DailyBar[] | Error>;
    history?: Record<string, OHLC[] | Error>;
    /** Provider rows per symbol that couldn't be read and were left out of its history. */
    unreadable?: Record<string, number>;
    /** Every split the "provider" knows; answers are cut to the asked range. */
    splits?: SplitEvent[] | Error;
    /** Calls (as recorded in `calls`) answered with a 429 the first time only. */
    rateLimitedOnce?: string[];
    onCall?: () => void;
} = {}) {
    const calls: string[] = [];
    const limited = new Set(rateLimitedOnce);
    const record = (call: string) => {
        calls.push(call);
        onCall?.();
        if (limited.delete(call)) throw new PolygonRateLimitError(1_000, `https://api.polygon.io/${call}`);
    };
    const adapter: PriceIngestAdapter = {
        isConfigured: configured,
        async getDailyBars(date) {
            record(`daily ${date}`);
            const value = daily[date];
            if (value instanceof Error) throw value;
            return new Map((value ?? []).map((bar) => [bar.symbol, bar]));
        },
        async getDailyHistory(symbol, range) {
            record(`history ${symbol} ${range}`);
            const value = history[symbol];
            if (value instanceof Error) throw value;
            return { bars: value ?? [], unreadable: unreadable[symbol] ?? 0 };
        },
        async getSplits(from, to) {
            record(`splits ${from} ${to}`);
            if (splits instanceof Error) throw splits;
            return splits.filter((split) => split.executionDate >= from && split.executionDate <= to);
        },
    };
    return { adapter, calls };
}

/** An in-memory price store with the real one's rules (normalizing, the bar FK, dedupe). */
function fakeStore({
    holdings = [],
    loaded = [...BENCHMARK_SYMBOLS],
    queued = [],
    bars = [],
    trackedAt = {},
    positions = {},
}: {
    holdings?: string[];
    /** Tracked symbols whose history is already loaded. */
    loaded?: string[];
    /** Tracked symbols still waiting for history. */
    queued?: string[];
    bars?: PriceBarInput[];
    /** When a symbol started being tracked; default the morning of the run. */
    trackedAt?: Record<string, string>;
    /** Positions a split adjustment finds per symbol (default 1). */
    positions?: Record<string, number>;
} = {}) {
    const securities = new Map<string, string | null>([
        ...loaded.map((symbol) => [symbol, "2024-10-16"] as const),
        ...queued.map((symbol) => [symbol, null] as const),
    ]);
    const created = new Map([...securities.keys()].map((symbol) => [symbol, Date.parse(trackedAt[symbol] ?? "2026-10-16T12:00:00Z")]));
    const stored = new Map(bars.map((bar) => [`${bar.symbol}|${bar.date}`, bar]));
    const marks: Array<[string, string]> = [];
    const resets: string[] = [];
    const attempted = new Map<string, number>();
    const adjustments: HoldingSplit[] = [];
    // A loaded symbol has history older than anything a test stores; it
    // isn't modelled bar by bar, so it never moves the catch-up bookmark.
    const olderHistory = new Set(loaded);
    const barsFor = (symbol: string) => olderHistory.has(symbol) || [...stored.values()].some((bar) => bar.symbol === symbol);
    // Priority symbols first; within each group never tried first, then least recently tried.
    const queue = (priority: readonly string[]) => {
        const waiting = [...securities].filter(([symbol, start]) => start === null && (priority.includes(symbol) || barsFor(symbol)));
        const order = (group: typeof waiting) => [
            ...group.filter(([symbol]) => !attempted.has(symbol)),
            ...group.filter(([symbol]) => attempted.has(symbol)).sort(([a], [b]) => attempted.get(a)! - attempted.get(b)!),
        ];
        return [...order(waiting.filter(([symbol]) => priority.includes(symbol))), ...order(waiting.filter(([symbol]) => !priority.includes(symbol)))]
            .map(([symbol]) => symbol);
    };

    const store: PriceIngestStore = {
        listHeldSymbols: async () => [...holdings],
        async trackSecurities(symbols) {
            const added = normalizeSymbols(symbols).filter((symbol) => !securities.has(symbol));
            for (const symbol of added) {
                securities.set(symbol, null);
                created.set(symbol, Date.parse(FRIDAY_EVENING));
            }
            return added;
        },
        listTrackedSymbols: async () => new Set(securities.keys()),
        async getLatestBarDate() {
            const dates = [...stored.values()].map((bar) => bar.date).sort();
            return dates.at(-1) ?? null;
        },
        async upsertBars(input) {
            const valid = dedupeBars(input.filter(isValidBar));
            for (const bar of valid) {
                assert.ok(securities.has(bar.symbol), `${bar.symbol} is not tracked (price_bars has a foreign key)`);
                stored.set(`${bar.symbol}|${bar.date}`, bar);
            }
            return { stored: valid.length, rejected: input.length - input.filter(isValidBar).length };
        },
        // The real queue's rules: priority symbols, or ones a daily file priced; priority first.
        listSymbolsNeedingHistory: async (limit, priority) => queue(priority).slice(0, limit),
        countSymbolsNeedingHistory: async (priority) => queue(priority).length,
        async pruneUnpricedSecurities(keep, trackedBefore) {
            const dropped = [...securities]
                .filter(([symbol, start]) => start === null && !keep.includes(symbol) && !barsFor(symbol)
                    && (created.get(symbol) ?? 0) < trackedBefore.getTime())
                .map(([symbol]) => symbol);
            for (const symbol of dropped) securities.delete(symbol);
            return dropped;
        },
        async markHistoryLoaded(symbol, startDate) {
            securities.set(symbol, startDate);
            attempted.delete(symbol);
            marks.push([symbol, startDate]);
        },
        async markHistoryAttempted(symbol, at) {
            attempted.set(symbol, at.getTime());
        },
        async replaceHistory(symbol, input, through, unreadableRows) {
            const own = input.filter((bar) => bar.symbol === symbol && bar.date <= through);
            const valid = dedupeBars(own.filter(isValidBar));
            if (valid.length === 0) return undefined;
            const historyEnd = valid.map((bar) => bar.date).sort().at(-1)!;
            const historyStart = valid.map((bar) => bar.date).sort()[0];
            const rejected = input.length - own.filter(isValidBar).length;
            // As in the real store: nothing is written unless every stored date from the
            // history's first day through the cut-off is in it; loaded only if nothing is missing.
            const covered = new Set(valid.map((bar) => bar.date));
            const uncovered = [...stored.values()].some((bar) =>
                bar.symbol === symbol && bar.date >= historyStart && bar.date <= through && !covered.has(bar.date));
            if (uncovered) return { stored: 0, rejected, historyStart, complete: false };
            for (const [key, bar] of stored) if (bar.symbol === symbol && bar.date <= historyEnd) stored.delete(key);
            olderHistory.delete(symbol);
            for (const bar of valid) stored.set(`${bar.symbol}|${bar.date}`, bar);
            const missing = unreadableRows + own.filter((bar) => !isValidBar(bar)).length;
            if (missing > 0) return { stored: valid.length, rejected, historyStart, complete: false };
            securities.set(symbol, historyStart);
            attempted.delete(symbol);
            marks.push([symbol, historyStart]);
            return { stored: valid.length, rejected, historyStart, complete: true };
        },
        hasBars: async (symbol) => barsFor(symbol),
        async resetUnpricedHistories(symbols) {
            const reset = normalizeSymbols(symbols).filter((symbol) => securities.get(symbol) && !barsFor(symbol));
            for (const symbol of reset) {
                securities.set(symbol, null);
                attempted.delete(symbol);
            }
            return reset;
        },
        async adjustHoldingsForSplit(split) {
            adjustments.push(split);
            return positions[split.symbol] ?? 1;
        },
        async clearSplitHistories(symbols) {
            const cleared = normalizeSymbols(symbols).filter((symbol) => securities.has(symbol));
            for (const [key, bar] of stored) if (cleared.includes(bar.symbol)) stored.delete(key);
            for (const symbol of cleared) {
                olderHistory.delete(symbol);
                securities.set(symbol, null);
                attempted.delete(symbol);
            }
            resets.push(...cleared);
            return cleared;
        },
        async resetHistory(symbols) {
            const reset = normalizeSymbols(symbols).filter((symbol) => securities.get(symbol));
            for (const symbol of reset) {
                securities.set(symbol, null);
                attempted.delete(symbol);
            }
            resets.push(...reset);
            return reset;
        },
    };
    return { store, securities, stored, marks, resets, attempted, adjustments };
}

function storedDates(stored: Map<string, PriceBarInput>, symbol: string): string[] {
    return [...stored.values()].filter((bar) => bar.symbol === symbol).map((bar) => bar.date).sort();
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("tradingDaysToIngest", () => {
    test("lists the trading days after the stored date, skipping weekends and holidays", () => {
        // Thanksgiving (26 November 2026) is closed; the 27th is an early close but trades.
        assert.deepEqual(tradingDaysToIngest("2026-11-24", "2026-11-30"), ["2026-11-25", "2026-11-27", "2026-11-30"]);
    });

    test("is empty when the store is up to date", () => {
        assert.deepEqual(tradingDaysToIngest("2026-10-16", "2026-10-16"), []);
        assert.deepEqual(tradingDaysToIngest("2026-10-19", "2026-10-16"), []);
    });

    test("with nothing stored, is just the last completed session", () => {
        assert.deepEqual(tradingDaysToIngest(null, "2026-10-16"), ["2026-10-16"]);
    });
});

describe("historyToBars", () => {
    test("keys bars by the Eastern trading date of their timestamp", () => {
        const bars = historyToBars("AAPL", [
            ohlc("2026-03-06T05:00:00.000Z"), // midnight EST
            ohlc("2026-03-09T04:00:00.000Z"), // midnight EDT, the day after clocks change
            ohlc("2026-07-01T04:00:00.000Z"),
        ], "2026-10-16");

        assert.deepEqual(bars.map((bar) => bar.date), ["2026-03-06", "2026-03-09", "2026-07-01"]);
        assert.deepEqual(bars[0], {
            symbol: "AAPL",
            date: "2026-03-06",
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1_000,
            source: "massive",
        });
    });

    test("uses the Eastern date where it differs from the UTC date", () => {
        // 02:30Z on 2 July is 10:30 PM on 1 July in New York.
        assert.deepEqual(historyToBars("AAPL", [ohlc("2026-07-02T02:30:00.000Z")], "2026-10-16").map((bar) => bar.date), ["2026-07-01"]);
    });

    test("drops bars after the cut-off day and unreadable timestamps", () => {
        const bars = historyToBars("AAPL", [
            ohlc("2026-10-15T04:00:00.000Z"),
            ohlc("2026-10-16T04:00:00.000Z"),
            ohlc("not a timestamp"),
        ], "2026-10-15");
        assert.deepEqual(bars.map((bar) => bar.date), ["2026-10-15"]);
    });
});

describe("pacingDelay", () => {
    test("lets the first calls of a window go at once", () => {
        assert.equal(pacingDelay([], 0, 5, 65_000), 0);
        assert.equal(pacingDelay([0, 1, 2, 3], 4, 5, 65_000), 0);
    });

    test("holds the next call until the oldest of the last five leaves the window", () => {
        assert.equal(pacingDelay([0, 1_000, 2_000, 3_000, 4_000], 5_000, 5, 65_000), 60_000);
        assert.equal(pacingDelay([0, 1_000, 2_000, 3_000, 4_000, 65_000], 66_000, 5, 65_000), 0);
        assert.equal(pacingDelay([0, 1_000, 2_000, 3_000, 4_000], 70_000, 5, 65_000), 0);
    });
});

describe("createCallPacer", () => {
    test("sleeps when the window is full and refuses calls that would overrun the deadline", async () => {
        const clock = fakeClock("2026-10-16T22:30:00.000Z");
        const start = clock.now().getTime();
        const pacer = createCallPacer({ now: clock.now, sleep: clock.sleep, deadline: start + 80_000 });

        for (let i = 0; i < 5; i++) assert.equal(await pacer.acquire(), true);
        assert.deepEqual(clock.sleeps, []);

        // Sixth call: waits 65 s, then has 15 s left, more than the 10 s allowance.
        assert.equal(await pacer.acquire(), true);
        assert.deepEqual(clock.sleeps, [65_000]);

        // The rest of the second window goes at once; then the next window is past the deadline.
        for (let i = 0; i < 4; i++) assert.equal(await pacer.acquire(), true);
        assert.equal(await pacer.acquire(), false);
        assert.equal(pacer.calls, 10);
    });
});

// ---------------------------------------------------------------------------
// The ingest
// ---------------------------------------------------------------------------

describe("ingestDailyPrices", () => {
    test("skips cleanly without an API key, touching neither the provider nor the database", async () => {
        const { adapter, calls } = fakeAdapter({ configured: false });
        const untouchable = new Proxy({}, {
            get: () => () => assert.fail("the store was used"),
        }) as PriceIngestStore;

        const detail = await ingestDailyPrices({ adapter, store: untouchable, ...fakeClock() });

        assert.deepEqual(detail, { skipped: "Market data is not configured: POLYGON_API_KEY is not set." });
        assert.deepEqual(calls, []);
    });

    test("tracks every held symbol and the benchmarks, dropping non-tickers", async () => {
        const { store, securities } = fakeStore({
            loaded: [],
            holdings: ["aapl", "MSFT", "AAPL260116C00250000", "CASH & SWEEP", "SPY"],
        });
        const { adapter } = fakeAdapter({ daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] } });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        for (const symbol of [...BENCHMARK_SYMBOLS, "AAPL", "MSFT"]) assert.ok(securities.has(symbol), `${symbol} not tracked`);
        assert.equal(securities.size, BENCHMARK_SYMBOLS.length + 2);
        assert.deepEqual(new Set(detail.newlyTracked), new Set([...BENCHMARK_SYMBOLS, "AAPL", "MSFT"]));
        assert.equal(detail.tracked, BENCHMARK_SYMBOLS.length + 2);
        assert.ok(BENCHMARK_SYMBOLS.includes("XLRE") && BENCHMARK_SYMBOLS.includes("XLC"));
    });

    test("on the first run stores only the last completed session, for tracked symbols", async () => {
        const { store, stored } = fakeStore({ holdings: ["AAPL"] });
        const { adapter, calls } = fakeAdapter({
            daily: {
                "2026-10-16": [dailyBar("AAPL", "2026-10-16"), dailyBar("SPY", "2026-10-16"), dailyBar("ZZZZ", "2026-10-16")],
            },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        // Splits are asked about on the first run too: one on that session still moves held positions.
        assert.deepEqual(calls.slice(0, 2), ["splits 2026-10-16 2026-10-16", "daily 2026-10-16"]);
        assert.equal(calls.filter((call) => call.startsWith("daily")).length, 1);
        assert.deepEqual(detail.splits, { from: "2026-10-16", to: "2026-10-16", reset: [] });
        assert.deepEqual(detail.days, [{ date: "2026-10-16", stored: 2, rejected: 0 }]);
        assert.equal(detail.session, "2026-10-16");
        assert.equal(detail.daysBehind, 0);
        assert.deepEqual(storedDates(stored, "ZZZZ"), []);
        assert.equal(stored.get("SPY|2026-10-16")?.source, "massive");
    });

    test("catches up missed days oldest first, at most five a run", async () => {
        const { store, stored } = fakeStore({ bars: [{ ...dailyBar("SPY", "2026-10-05"), source: "massive" }] });
        const missed = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
        const { adapter, calls } = fakeAdapter({
            daily: Object.fromEntries(missed.map((date) => [date, [dailyBar("SPY", date)]])),
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        // One splits call for the five days, before any of them is stored.
        assert.deepEqual(calls, ["splits 2026-10-06 2026-10-12", ...missed.slice(0, 5).map((date) => `daily ${date}`)]);
        assert.deepEqual(detail.days?.map((day) => day.date), missed.slice(0, 5));
        assert.equal(detail.daysBehind, 4);
        assert.equal(detail.stopped?.catchUp, undefined);
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-05", ...missed.slice(0, 5)]);
    });

    test("regression: an empty day followed by a published one was a closure, and is passed", async () => {
        // Wednesday the 14th closed unexpectedly (unknown to the calendar).
        const { store, stored } = fakeStore({ bars: [{ ...dailyBar("SPY", "2026-10-13"), source: "massive" }] });
        const { adapter } = fakeAdapter({
            daily: { "2026-10-14": [], "2026-10-15": [dailyBar("SPY", "2026-10-15")], "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(detail.days, [
            { date: "2026-10-14", stored: 0, rejected: 0, closed: true },
            { date: "2026-10-15", stored: 1, rejected: 0 },
            { date: "2026-10-16", stored: 1, rejected: 0 },
        ]);
        assert.deepEqual(detail.stopped, {});
        assert.equal(detail.daysBehind, 0);
        assert.equal(detail.historyThrough, "2026-10-16");
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-13", "2026-10-15", "2026-10-16"]);
    });

    test("empty days with nothing published after them wait for the next run", async () => {
        const { store, stored } = fakeStore({ bars: [{ ...dailyBar("SPY", "2026-10-14"), source: "massive" }] });
        const { adapter } = fakeAdapter({ daily: { "2026-10-15": [], "2026-10-16": [] } });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(detail.days, []);
        assert.equal(detail.stopped?.catchUp, "not-published");
        assert.equal(detail.daysBehind, 2);
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-14"]);
    });

    test("does nothing more when the store is already up to date", async () => {
        const { store } = fakeStore({ bars: [{ ...dailyBar("SPY", "2026-10-16"), source: "massive" }] });
        const { adapter, calls } = fakeAdapter();

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(calls, []);
        assert.deepEqual(detail.days, []);
        assert.equal(detail.daysBehind, 0);
        assert.equal(detail.calls, 0);
        assert.deepEqual(detail.splits, { skipped: "up to date" });
    });

    test("an unpublished day ends the catch-up without failing, and history stops at the last stored day", async () => {
        const { store, stored, marks } = fakeStore({
            holdings: ["AAPL"],
            queued: ["AAPL"],
            bars: [{ ...dailyBar("SPY", "2026-10-13"), source: "massive" }],
        });
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-14": [dailyBar("SPY", "2026-10-14")], "2026-10-15": [] },
            history: {
                AAPL: [ohlc("2026-10-13T04:00:00.000Z"), ohlc("2026-10-14T04:00:00.000Z"), ohlc("2026-10-15T04:00:00.000Z")],
            },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        // The 15th is empty, so the 16th is asked for: nothing there either, so neither is out yet.
        assert.deepEqual(calls, ["splits 2026-10-14 2026-10-16", "daily 2026-10-14", "daily 2026-10-15", "daily 2026-10-16", "history AAPL 2Y"]);
        assert.deepEqual(detail.days, [{ date: "2026-10-14", stored: 1, rejected: 0 }]);
        assert.equal(detail.stopped?.catchUp, "not-published");
        assert.equal(detail.daysBehind, 2);
        assert.equal(detail.historyThrough, "2026-10-14");
        // The 15th waits for its daily file, so the catch-up bookmark stays right.
        assert.deepEqual(storedDates(stored, "AAPL"), ["2026-10-13", "2026-10-14"]);
        assert.deepEqual(marks, [["AAPL", "2026-10-13"]]);
    });

    test("backfills history keyed by Eastern date and marks where it starts", async () => {
        const { store, stored, marks, securities } = fakeStore({ queued: ["AAPL"] });
        const { adapter } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("AAPL", "2026-10-16", 250)] },
            history: {
                AAPL: [
                    ohlc("2024-10-17T04:00:00.000Z", 230),
                    ohlc("2026-01-05T05:00:00.000Z", 240),
                    ohlc("2026-10-16T04:00:00.000Z", 250),
                ],
            },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(storedDates(stored, "AAPL"), ["2024-10-17", "2026-01-05", "2026-10-16"]);
        assert.deepEqual(marks, [["AAPL", "2024-10-17"]]);
        assert.equal(securities.get("AAPL"), "2024-10-17");
        assert.deepEqual(detail.backfilled, [{ symbol: "AAPL", stored: 3, rejected: 0, historyStart: "2024-10-17" }]);
        assert.equal(detail.backfillQueue, 0);
    });

    test("regression: a history missing sessions (a rejected or unreadable row) writes what it has but stays queued", async () => {
        for (const missing of [
            { history: [{ ...ohlc("2026-10-15T04:00:00.000Z"), high: 1 }], unreadable: 0 }, // inconsistent: rejected
            { history: [], unreadable: 1 }, // left out by the adapter
        ]) {
            const { store, stored, marks, securities, attempted } = fakeStore({ queued: ["AAPL"] });
            const { adapter } = fakeAdapter({
                daily: { "2026-10-16": [dailyBar("AAPL", "2026-10-16", 250)] },
                history: { AAPL: [ohlc("2024-10-17T04:00:00.000Z", 230), ohlc("2026-10-16T04:00:00.000Z", 250), ...missing.history] },
                unreadable: { AAPL: missing.unreadable },
            });

            const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

            assert.deepEqual(storedDates(stored, "AAPL"), ["2024-10-17", "2026-10-16"], "the readable sessions are kept");
            assert.deepEqual(marks, [], "not marked loaded: a session is missing");
            assert.equal(securities.get("AAPL"), null);
            assert.ok(attempted.has("AAPL"));
            assert.equal(detail.backfilled?.[0].complete, false);
            assert.equal(detail.backfillQueue, 1);
        }
    });

    test("regression: a held symbol that failed once is retried before never-tried looked-up symbols", async () => {
        const { store } = fakeStore({
            holdings: ["HELD"],
            queued: ["HELD", "LOOK1", "LOOK2"],
            bars: [
                { ...dailyBar("SPY", "2026-10-15"), source: "massive" },
                { ...dailyBar("LOOK1", "2026-10-15"), source: "massive" },
                { ...dailyBar("LOOK2", "2026-10-15"), source: "massive" },
            ],
        });
        // Each call takes 3 s; a 20 s budget fits the splits call, the daily file and two histories.
        const clock = fakeClock();
        const first = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            history: { HELD: new PolygonApiError(502, "Bad Gateway", "https://api.polygon.io/v2/aggs/ticker/HELD?apiKey=***") },
            onCall: () => clock.advance(3_000),
        });
        await ingestDailyPrices({ adapter: first.adapter, store, now: clock.now, sleep: clock.sleep, budgetMs: 20_000 });
        assert.deepEqual(first.calls.filter((call) => call.startsWith("history")), ["history HELD 2Y", "history LOOK1 2Y"]);

        const second = fakeAdapter({});
        await ingestDailyPrices({ adapter: second.adapter, store, ...fakeClock("2026-10-17T22:30:00.000Z") });
        assert.equal(second.calls.filter((call) => call.startsWith("history"))[0], "history HELD 2Y");
    });

    test("marks a symbol with no history so the queue moves on", async () => {
        const { store, marks } = fakeStore({ holdings: ["GONE", "MISSING"], queued: ["GONE", "MISSING"] });
        const { adapter } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            history: { GONE: [], MISSING: new PolygonApiError(404, "Not Found", "https://api.polygon.io/v2/aggs/ticker/MISSING") },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(marks, [["GONE", "2026-10-16"], ["MISSING", "2026-10-16"]]);
        assert.deepEqual(detail.backfilled, [
            { symbol: "GONE", stored: 0, rejected: 0, historyStart: "2026-10-16", empty: true },
            { symbol: "MISSING", stored: 0, rejected: 0, historyStart: "2026-10-16", empty: true },
        ]);
        assert.equal(detail.backfillQueue, 0);
    });

    test("with nothing stored and the session unpublished, history stops the day before", async () => {
        const { store, stored } = fakeStore({ holdings: ["AAPL"], queued: ["AAPL"] });
        const { adapter } = fakeAdapter({
            daily: { "2026-10-16": [] },
            history: { AAPL: [ohlc("2026-10-15T04:00:00.000Z"), ohlc("2026-10-16T04:00:00.000Z")] },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.equal(detail.stopped?.catchUp, "not-published");
        assert.equal(detail.historyThrough, "2026-10-15");
        assert.deepEqual(storedDates(stored, "AAPL"), ["2026-10-15"]);
        // Next run catches up from the 15th, so the 16th comes from its daily file.
        assert.equal(detail.daysBehind, 1);
    });

    test("paces calls and stops the backfill when the time budget would be exceeded", async () => {
        const queued = Array.from({ length: 20 }, (_, i) => `SYM${String.fromCharCode(65 + i)}`);
        const { store } = fakeStore({ holdings: queued, queued });
        const clock = fakeClock();
        // Every call takes a second.
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            onCall: () => clock.advance(1_000),
        });

        const detail = await ingestDailyPrices({ adapter, store, now: clock.now, sleep: clock.sleep, budgetMs: 100_000 });

        // Five calls, a 60 s wait for the window, five more; the next window
        // would open at 130 s, past the 100 s budget. Splits and the daily
        // file take two of the ten.
        assert.deepEqual(clock.sleeps, [60_000]);
        assert.equal(calls.length, 10);
        assert.equal(detail.calls, 10);
        assert.equal(detail.backfilled?.length, 8);
        assert.equal(detail.stopped?.backfill, "budget");
        assert.equal(detail.backfillQueue, 12);
    });

    test("with the default budget, never sleeps longer than a window between calls", async () => {
        const queued = Array.from({ length: 30 }, (_, i) => `Q${i}`);
        const { store } = fakeStore({ holdings: queued, queued });
        const clock = fakeClock();
        const { adapter } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            onCall: () => clock.advance(1_000),
        });

        const detail = await ingestDailyPrices({ adapter, store, now: clock.now, sleep: clock.sleep });
        const elapsed = clock.now().getTime() - Date.parse(FRIDAY_EVENING);

        assert.equal(detail.stopped?.backfill, "budget");
        assert.ok(clock.sleeps.every((ms) => ms <= 65_000));
        assert.ok(elapsed <= 240_000, `ran for ${elapsed} ms`);
        assert.ok((detail.calls ?? 0) >= 15, `only ${detail.calls} calls`);
    });

    test("a rate limit is waited out and the call made again", async () => {
        const { store, marks } = fakeStore({
            holdings: ["AAA", "BBB"],
            queued: ["AAA", "BBB"],
            bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }],
        });
        const clock = fakeClock();
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            rateLimitedOnce: ["splits 2026-10-16 2026-10-16", "daily 2026-10-16", "history BBB 2Y"],
        });

        const detail = await ingestDailyPrices({ adapter, store, now: clock.now, sleep: clock.sleep });

        assert.deepEqual(calls, [
            "splits 2026-10-16 2026-10-16", "splits 2026-10-16 2026-10-16",
            "daily 2026-10-16", "daily 2026-10-16",
            "history AAA 2Y", "history BBB 2Y", "history BBB 2Y",
        ]);
        // Retry-After said 1 s; the wait is at least 15 s (a 429 alone says little).
        assert.equal(clock.sleeps.filter((ms) => ms === 15_000).length, 3);
        assert.deepEqual(detail.days?.map((day) => day.date), ["2026-10-16"]);
        assert.deepEqual(marks.map(([symbol]) => symbol), ["AAA", "BBB"]);
        assert.deepEqual(detail.stopped, {});
    });

    test("a rate limit that outlasts the budget stops the backfill for this run without failing", async () => {
        const { store, marks } = fakeStore({ holdings: ["AAA", "BBB", "CCC", "DDD"], queued: ["AAA", "BBB", "CCC", "DDD"] });
        const clock = fakeClock();
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            history: { CCC: new PolygonRateLimitError(1_000, "https://api.polygon.io/v2/aggs/ticker/CCC") },
        });

        const detail = await ingestDailyPrices({ adapter, store, now: clock.now, sleep: clock.sleep });

        assert.deepEqual(calls.slice(0, 5), ["splits 2026-10-16 2026-10-16", "daily 2026-10-16", "history AAA 2Y", "history BBB 2Y", "history CCC 2Y"]);
        assert.ok(calls.slice(4).every((call) => call === "history CCC 2Y"), "only CCC is retried");
        assert.deepEqual(marks.map(([symbol]) => symbol), ["AAA", "BBB"]);
        assert.equal(detail.stopped?.backfill, "rate-limited");
        assert.equal(detail.backfillQueue, 2);
        assert.ok(clock.now().getTime() - Date.parse(FRIDAY_EVENING) <= 240_000, "stayed within the budget");
    });

    test("a rate limit that outlasts the budget during the catch-up ends the run's calls without failing", async () => {
        const { store } = fakeStore({ holdings: ["AAA"], queued: ["AAA"], bars: [{ ...dailyBar("SPY", "2026-10-14"), source: "massive" }] });
        const { adapter, calls } = fakeAdapter({
            daily: {
                "2026-10-15": [dailyBar("SPY", "2026-10-15")],
                "2026-10-16": new PolygonRateLimitError(1_000, "https://api.polygon.io/v2/aggs/grouped"),
            },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(calls.slice(0, 3), ["splits 2026-10-15 2026-10-16", "daily 2026-10-15", "daily 2026-10-16"]);
        assert.ok(calls.slice(2).every((call) => call === "daily 2026-10-16"));
        assert.deepEqual(detail.stopped, { catchUp: "rate-limited", backfill: "rate-limited" });
        assert.equal(detail.daysBehind, 1);
        assert.equal(detail.backfillQueue, 1);
    });

    test("another provider error during the catch-up fails the run", async () => {
        const { store } = fakeStore();
        const { adapter } = fakeAdapter({
            daily: { "2026-10-16": new PolygonApiError(500, "Internal Server Error", "https://api.polygon.io/v2/aggs/grouped") },
        });

        await assert.rejects(ingestDailyPrices({ adapter, store, ...fakeClock() }), PolygonApiError);
    });

    test("one symbol's failed backfill is reported and stays queued; the rest continue", async () => {
        const { store, marks, securities } = fakeStore({ holdings: ["AAA", "BBB"], queued: ["AAA", "BBB"] });
        const { adapter } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            history: {
                AAA: new PolygonApiError(502, "Bad Gateway", "https://api.polygon.io/v2/aggs/ticker/AAA?apiKey=***"),
                BBB: [ohlc("2026-10-16T04:00:00.000Z")],
            },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(detail.backfillErrors, [{
            symbol: "AAA",
            error: "PolygonMassiveAdapter: HTTP 502 Bad Gateway — https://api.polygon.io/v2/aggs/ticker/AAA?apiKey=***",
        }]);
        assert.deepEqual(marks, [["BBB", "2026-10-16"]]);
        assert.equal(securities.get("AAA"), null);
        assert.equal(detail.backfillQueue, 1);
    });

    test("a split on a stored day re-queues the stock, and the backfill replaces its history on the new scale", async () => {
        // NVDA split 10-for-1 on Thursday the 15th; its stored history is on the old scale.
        const { store, stored, resets, securities } = fakeStore({
            holdings: ["NVDA", "MSFT"],
            loaded: [...BENCHMARK_SYMBOLS, "NVDA", "AAPL"],
            queued: ["MSFT"],
            bars: [
                { ...dailyBar("NVDA", "2024-10-01", 900), source: "massive" }, // before the refetched window
                { ...dailyBar("NVDA", "2026-10-14", 1_000), source: "massive" },
                { ...dailyBar("AAPL", "2026-10-14", 250), source: "massive" },
            ],
        });
        const { adapter, calls } = fakeAdapter({
            splits: [
                { symbol: "NVDA", executionDate: "2026-10-15" },
                { symbol: "MSFT", executionDate: "2026-10-16" }, // queued: its first backfill is adjusted anyway
                { symbol: "ZZZZ", executionDate: "2026-10-16" }, // not tracked
            ],
            daily: {
                "2026-10-15": [dailyBar("NVDA", "2026-10-15", 101), dailyBar("AAPL", "2026-10-15", 251)],
                "2026-10-16": [dailyBar("NVDA", "2026-10-16", 102), dailyBar("AAPL", "2026-10-16", 252)],
            },
            history: {
                NVDA: [
                    ohlc("2024-10-17T04:00:00.000Z", 90),
                    ohlc("2026-10-14T04:00:00.000Z", 100),
                    ohlc("2026-10-15T04:00:00.000Z", 101),
                    ohlc("2026-10-16T04:00:00.000Z", 102),
                ],
                MSFT: [ohlc("2026-10-16T04:00:00.000Z", 400)],
            },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(calls, [
            "splits 2026-10-15 2026-10-16",
            "daily 2026-10-15",
            "daily 2026-10-16",
            "history NVDA 2Y",
            "history MSFT 2Y",
        ]);
        // Both tracked stocks that split are cleared and re-queued (MSFT had nothing stored yet).
        // No ratios in these events, so the held positions are reported, not adjusted.
        assert.deepEqual(detail.splits, { from: "2026-10-15", to: "2026-10-16", reset: ["NVDA", "MSFT"], unadjusted: ["NVDA", "MSFT"] });
        assert.deepEqual(resets, ["NVDA", "MSFT"]);
        // Only the adjusted history is left: the old-scale bars are gone, the 14th is rescaled.
        assert.deepEqual(storedDates(stored, "NVDA"), ["2024-10-17", "2026-10-14", "2026-10-15", "2026-10-16"]);
        assert.equal(stored.get("NVDA|2026-10-14")?.close, 100);
        assert.equal(securities.get("NVDA"), "2024-10-17");
        // AAPL didn't split.
        assert.equal(stored.get("AAPL|2026-10-14")?.close, 250);
        assert.equal(securities.get("AAPL"), "2024-10-16");
        assert.equal(detail.backfillQueue, 0);
    });

    test("a split in the window is handled before any day is stored, even on a day not published yet", async () => {
        const { store, resets, stored } = fakeStore({
            holdings: ["NVDA"],
            loaded: [...BENCHMARK_SYMBOLS, "NVDA"],
            bars: [{ ...dailyBar("SPY", "2026-10-14"), source: "massive" }, { ...dailyBar("NVDA", "2026-10-14", 1_000), source: "massive" }],
        });
        const splits = [{ symbol: "NVDA", executionDate: "2026-10-16" }];
        // The 16th's file isn't out, but the split is known: NVDA is re-queued
        // at once, and its history refetched (already adjusted for it).
        const unpublished = fakeAdapter({
            splits,
            daily: { "2026-10-15": [dailyBar("SPY", "2026-10-15"), dailyBar("NVDA", "2026-10-15", 1_010)], "2026-10-16": [] },
            history: { NVDA: [ohlc("2026-10-14T04:00:00.000Z", 100), ohlc("2026-10-15T04:00:00.000Z", 101)] },
        });

        const first = await ingestDailyPrices({ adapter: unpublished.adapter, store, ...fakeClock() });

        assert.deepEqual(first.splits, { from: "2026-10-15", to: "2026-10-16", reset: ["NVDA"], unadjusted: ["NVDA"] });
        assert.ok(unpublished.calls.includes("history NVDA 2Y"));
        assert.equal(stored.get("NVDA|2026-10-15")?.close, 101);

        // The next run stores the 16th, sees the split again and refetches once more.
        const published = fakeAdapter({
            splits,
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16"), dailyBar("NVDA", "2026-10-16", 102)] },
            history: { NVDA: [ohlc("2026-10-14T04:00:00.000Z", 100), ohlc("2026-10-15T04:00:00.000Z", 101), ohlc("2026-10-16T04:00:00.000Z", 102)] },
        });
        const second = await ingestDailyPrices({ adapter: published.adapter, store, ...fakeClock() });

        assert.equal(published.calls[0], "splits 2026-10-16 2026-10-16");
        assert.deepEqual(second.splits, { from: "2026-10-16", to: "2026-10-16", reset: ["NVDA"], unadjusted: ["NVDA"] });
        assert.deepEqual(resets, ["NVDA", "NVDA"]);
        assert.deepEqual(storedDates(stored, "NVDA").map((date) => stored.get(`NVDA|${date}`)?.close), [100, 101, 102]);
    });

    test("regression: a failure after an earlier day is stored still leaves that day's split handled", async () => {
        // The stored 15th becomes the bookmark, so its split must already be in the queue.
        const { store, stored, securities } = fakeStore({
            holdings: ["NVDA"],
            loaded: [...BENCHMARK_SYMBOLS, "NVDA"],
            bars: [{ ...dailyBar("SPY", "2026-10-14"), source: "massive" }, { ...dailyBar("NVDA", "2026-10-14", 1_000), source: "massive" }],
        });
        const failing = fakeAdapter({
            splits: [{ symbol: "NVDA", executionDate: "2026-10-15" }],
            daily: {
                "2026-10-15": [dailyBar("SPY", "2026-10-15"), dailyBar("NVDA", "2026-10-15", 101)],
                "2026-10-16": new PolygonApiError(502, "Bad Gateway", "https://api.polygon.io/v2/aggs/grouped?apiKey=***"),
            },
        });

        await assert.rejects(ingestDailyPrices({ adapter: failing.adapter, store, ...fakeClock() }), PolygonApiError);
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-14", "2026-10-15"]);
        assert.equal(securities.get("NVDA"), null);

        const next = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16"), dailyBar("NVDA", "2026-10-16", 102)] },
            history: { NVDA: [ohlc("2026-10-14T04:00:00.000Z", 100), ohlc("2026-10-15T04:00:00.000Z", 101), ohlc("2026-10-16T04:00:00.000Z", 102)] },
        });
        await ingestDailyPrices({ adapter: next.adapter, store, ...fakeClock() });

        assert.deepEqual(next.calls, ["splits 2026-10-16 2026-10-16", "daily 2026-10-16", "history NVDA 2Y"]);
        assert.equal(stored.get("NVDA|2026-10-14")?.close, 100);
    });

    test("regression: a split stock whose refetch brings nothing back stays queued", async () => {
        for (const history of [
            new PolygonApiError(404, "Not Found", "https://api.polygon.io/v2/aggs/ticker/NVDA?apiKey=***"),
            [],
            [{ ...ohlc("2026-10-15T04:00:00.000Z"), high: 1 }], // only an invalid bar
        ]) {
            const { store, securities, marks, stored } = fakeStore({
                holdings: ["NVDA"],
                loaded: [...BENCHMARK_SYMBOLS, "NVDA"],
                bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }, { ...dailyBar("NVDA", "2026-10-15", 1_000), source: "massive" }],
            });
            const { adapter } = fakeAdapter({
                splits: [{ symbol: "NVDA", executionDate: "2026-10-16" }],
                daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16"), dailyBar("NVDA", "2026-10-16", 102)] },
                history: { NVDA: history },
            });

            const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

            assert.equal(securities.get("NVDA"), null, "NVDA left the queue");
            assert.deepEqual(marks, []);
            assert.deepEqual(detail.backfillErrors, [{ symbol: "NVDA", error: "No history returned; still queued." }]);
            assert.equal(detail.backfillQueue, 1);
            // Regression: the old-scale bars went with the split, so the post-split
            // bar is never shown beside them while the refetch keeps failing.
            assert.deepEqual(storedDates(stored, "NVDA").map((date) => stored.get(`NVDA|${date}`)?.close), [102]);
        }
    });

    test("a failed split check stores nothing, so the next run asks about the same days", async () => {
        const { store, stored } = fakeStore({ bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }] });
        const daily = { "2026-10-16": [dailyBar("SPY", "2026-10-16")] };
        const failing = fakeAdapter({
            daily,
            splits: new PolygonApiError(502, "Bad Gateway", "https://api.polygon.io/v3/reference/splits?apiKey=***"),
        });

        await assert.rejects(ingestDailyPrices({ adapter: failing.adapter, store, ...fakeClock() }), PolygonApiError);
        assert.deepEqual(failing.calls, ["splits 2026-10-16 2026-10-16"]);
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-15"]);

        const working = fakeAdapter({ daily });
        const detail = await ingestDailyPrices({ adapter: working.adapter, store, ...fakeClock() });

        assert.deepEqual(working.calls, ["splits 2026-10-16 2026-10-16", "daily 2026-10-16"]);
        assert.deepEqual(detail.splits, { from: "2026-10-16", to: "2026-10-16", reset: [] });
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-15", "2026-10-16"]);
    });

    test("a split check rate-limited past the budget ends the run's calls and stores nothing", async () => {
        const { store, stored } = fakeStore({ holdings: ["AAA"], queued: ["AAA"], bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }] });
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            splits: new PolygonRateLimitError(1_000, "https://api.polygon.io/stocks/v1/splits?apiKey=***"),
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.ok(calls.length > 1 && calls.every((call) => call === "splits 2026-10-16 2026-10-16"));
        assert.deepEqual(detail.stopped, { catchUp: "rate-limited", backfill: "rate-limited" });
        assert.deepEqual(detail.days, []);
        assert.deepEqual(detail.splits, { skipped: "rate-limited" });
        assert.equal(detail.daysBehind, 1);
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-15"]);
    });

    test("regression: a 403 from the split check fails the run and stores nothing", async () => {
        // The splits endpoint is on every Stocks plan: a 403 is a key or plan
        // problem, and storing the day would leave its splits unchecked forever.
        const { store, stored } = fakeStore({ bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }] });
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            splits: new PolygonApiError(403, "Forbidden", "https://api.polygon.io/stocks/v1/splits?apiKey=***"),
        });

        await assert.rejects(ingestDailyPrices({ adapter, store, ...fakeClock() }), (error: unknown) => {
            assert.ok(error instanceof PolygonApiError);
            assert.equal(error.status, 403);
            return true;
        });
        assert.deepEqual(calls, ["splits 2026-10-16 2026-10-16"]);
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-15"]);
    });
});

describe("ingestDailyPrices › held positions after a split", () => {
    test("held stocks that split have their positions adjusted, oldest split first; others are left alone", async () => {
        const { store, adjustments } = fakeStore({
            holdings: ["NVDA", "AAPL"],
            loaded: [...BENCHMARK_SYMBOLS, "NVDA", "AAPL", "TSLA"],
            bars: [{ ...dailyBar("SPY", "2026-10-14"), source: "massive" }],
            positions: { NVDA: 2, AAPL: 0 },
        });
        const { adapter } = fakeAdapter({
            splits: [
                { symbol: "NVDA", executionDate: "2026-10-16", splitFrom: 1, splitTo: 2 },
                { symbol: "NVDA", executionDate: "2026-10-15", splitFrom: 1, splitTo: 10 },
                { symbol: "TSLA", executionDate: "2026-10-15", splitFrom: 1, splitTo: 3 }, // tracked, not held
                { symbol: "AAPL", executionDate: "2026-10-16", splitFrom: 1, splitTo: 4 }, // held, positions already adjusted
            ],
            daily: { "2026-10-15": [dailyBar("SPY", "2026-10-15")], "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        // Oldest execution date first (then by symbol).
        assert.deepEqual(adjustments, [
            { symbol: "NVDA", executionDate: "2026-10-15", splitFrom: 1, splitTo: 10 },
            { symbol: "AAPL", executionDate: "2026-10-16", splitFrom: 1, splitTo: 4 },
            { symbol: "NVDA", executionDate: "2026-10-16", splitFrom: 1, splitTo: 2 },
        ]);
        const splits = detail.splits as Extract<typeof detail.splits, { reset: string[] }>;
        assert.deepEqual(splits.adjusted, [
            { symbol: "NVDA", executionDate: "2026-10-15", ratio: "10-for-1", positions: 2 },
            { symbol: "NVDA", executionDate: "2026-10-16", ratio: "2-for-1", positions: 2 },
        ]);
        assert.equal(splits.unadjusted, undefined);
    });

    test("regression: several actions for one stock on one day are applied together, duplicates once", async () => {
        const { store, adjustments } = fakeStore({
            holdings: ["NVDA"],
            loaded: [...BENCHMARK_SYMBOLS, "NVDA"],
            bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }],
        });
        const { adapter } = fakeAdapter({
            splits: [
                { symbol: "NVDA", executionDate: "2026-10-16", splitFrom: 1, splitTo: 2, id: "A" },
                { symbol: "NVDA", executionDate: "2026-10-16", splitFrom: 2, splitTo: 3, id: "B" },
                { symbol: "NVDA", executionDate: "2026-10-16", splitFrom: 1, splitTo: 2, id: "A" }, // listed twice
            ],
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(adjustments, [{ symbol: "NVDA", executionDate: "2026-10-16", splitFrom: 2, splitTo: 6 }]);
        assert.deepEqual((detail.splits as { adjusted?: unknown[] }).adjusted, [
            { symbol: "NVDA", executionDate: "2026-10-16", ratio: "6-for-2", positions: 1 },
        ]);
    });

    test("regression: a split on the first session moves held positions too", async () => {
        const { store, adjustments } = fakeStore({ holdings: ["NVDA"], queued: ["NVDA"] });
        const { adapter } = fakeAdapter({
            splits: [{ symbol: "NVDA", executionDate: "2026-10-16", splitFrom: 1, splitTo: 10 }],
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16"), dailyBar("NVDA", "2026-10-16", 100)] },
        });

        await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(adjustments, [{ symbol: "NVDA", executionDate: "2026-10-16", splitFrom: 1, splitTo: 10 }]);
    });

    test("a held stock that split without a usable ratio is reported, not adjusted", async () => {
        const { store, adjustments } = fakeStore({
            holdings: ["BRK.B"],
            loaded: [...BENCHMARK_SYMBOLS, "BRK.B"],
            bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }],
        });
        const { adapter } = fakeAdapter({
            splits: [{ symbol: "BRK.B", executionDate: "2026-10-16" }],
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(adjustments, []);
        assert.deepEqual((detail.splits as { unadjusted?: string[] }).unadjusted, ["BRK.B"]);
        assert.deepEqual((detail.splits as { reset: string[] }).reset, ["BRK.B"]);
    });
});

describe("ingestDailyPrices › incomplete days", () => {
    test("regression: a day's invalid bar for a tracked stock re-queues its history, which recovers that day", async () => {
        const { store, stored } = fakeStore({
            holdings: ["NVDA"],
            loaded: [...BENCHMARK_SYMBOLS, "NVDA"],
            bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }, { ...dailyBar("NVDA", "2026-10-15", 100), source: "massive" }],
        });
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16"), { ...dailyBar("NVDA", "2026-10-16", 102), high: 1 }] },
            history: { NVDA: [ohlc("2026-10-15T04:00:00.000Z", 100), ohlc("2026-10-16T04:00:00.000Z", 102)] },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(detail.days, [{ date: "2026-10-16", stored: 1, rejected: 1, requeued: ["NVDA"] }]);
        assert.ok(calls.includes("history NVDA 2Y"));
        assert.equal(stored.get("NVDA|2026-10-16")?.close, 102);
    });

    test("regression: a held symbol whose first backfill came back empty is asked again once a daily file prices it", async () => {
        const { store, stored, securities } = fakeStore({
            holdings: ["NEWCO"],
            queued: ["NEWCO"],
            bars: [{ ...dailyBar("SPY", "2026-10-14"), source: "massive" }],
        });
        // Not known to the history endpoint yet: marked loaded at the 15th.
        const first = fakeAdapter({ daily: { "2026-10-15": [dailyBar("SPY", "2026-10-15")], "2026-10-16": [] }, history: { NEWCO: [] } });
        await ingestDailyPrices({ adapter: first.adapter, store, ...fakeClock() });
        assert.equal(securities.get("NEWCO"), "2026-10-15");

        const second = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16"), dailyBar("NEWCO", "2026-10-16", 30)] },
            history: { NEWCO: [ohlc("2026-10-15T04:00:00.000Z", 29), ohlc("2026-10-16T04:00:00.000Z", 30)] },
        });
        const detail = await ingestDailyPrices({ adapter: second.adapter, store, ...fakeClock() });

        assert.deepEqual(detail.days?.[0].requeued, ["NEWCO"]);
        assert.ok(second.calls.includes("history NEWCO 2Y"));
        assert.deepEqual(storedDates(stored, "NEWCO"), ["2026-10-15", "2026-10-16"]);
        assert.equal(securities.get("NEWCO"), "2026-10-15");
    });

    test("a symbol with stored bars isn't re-queued just for being priced again", async () => {
        const { store } = fakeStore({ bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }] });
        const { adapter } = fakeAdapter({ daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] } });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(detail.days, [{ date: "2026-10-16", stored: 1, rejected: 0 }]);
    });
});

describe("ingestDailyPrices › backfill retries", () => {
    test("regression: a split stock whose refetched history stops short of stored bars stays queued", async () => {
        // The aggregates lag the daily files: the history ends on the 14th,
        // but the 15th's daily bar (before the split on the 16th) is stored.
        const { store, stored, securities, attempted } = fakeStore({
            holdings: ["NVDA"],
            loaded: [...BENCHMARK_SYMBOLS, "NVDA"],
            bars: [
                { ...dailyBar("SPY", "2026-10-15"), source: "massive" },
                { ...dailyBar("NVDA", "2026-10-14", 1_000), source: "massive" },
                { ...dailyBar("NVDA", "2026-10-15", 1_010), source: "massive" },
            ],
        });
        const lagging = fakeAdapter({
            splits: [{ symbol: "NVDA", executionDate: "2026-10-16" }],
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16"), dailyBar("NVDA", "2026-10-16", 102)] },
            history: { NVDA: [ohlc("2026-10-14T04:00:00.000Z", 100)] },
        });

        const detail = await ingestDailyPrices({ adapter: lagging.adapter, store, ...fakeClock() });

        assert.deepEqual(detail.backfilled, [{ symbol: "NVDA", stored: 0, rejected: 0, historyStart: "2026-10-14", complete: false }]);
        assert.equal(securities.get("NVDA"), null, "still queued");
        assert.ok(attempted.has("NVDA"));
        // Regression: the split cleared the old-scale 14th and 15th, and nothing is
        // written until a history covers the stored 16th, so no scales are mixed.
        assert.deepEqual(storedDates(stored, "NVDA").map((date) => stored.get(`NVDA|${date}`)?.close), [102]);

        // The next run's history covers the 15th and 16th: replaced and loaded.
        const caughtUp = fakeAdapter({
            history: { NVDA: [ohlc("2026-10-14T04:00:00.000Z", 100), ohlc("2026-10-15T04:00:00.000Z", 101), ohlc("2026-10-16T04:00:00.000Z", 102)] },
        });
        await ingestDailyPrices({ adapter: caughtUp.adapter, store, ...fakeClock() });
        assert.equal(securities.get("NVDA"), "2026-10-14");
        assert.deepEqual(storedDates(stored, "NVDA").map((date) => stored.get(`NVDA|${date}`)?.close), [100, 101, 102]);
    });

    test("regression: a history missing a stored day in the middle is not written", async () => {
        const { store, stored, securities } = fakeStore({
            holdings: ["GAP"],
            queued: ["GAP"],
            bars: [
                { ...dailyBar("SPY", "2026-10-16"), source: "massive" },
                { ...dailyBar("GAP", "2026-10-14", 50), source: "massive" },
                { ...dailyBar("GAP", "2026-10-15", 51), source: "massive" },
                { ...dailyBar("GAP", "2026-10-16", 52), source: "massive" },
            ],
        });
        // The 15th's aggregate was malformed and dropped by the provider adapter.
        const { adapter } = fakeAdapter({
            history: { GAP: [ohlc("2026-10-14T04:00:00.000Z", 50), ohlc("2026-10-16T04:00:00.000Z", 52)] },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.equal(detail.backfilled?.[0].complete, false);
        assert.equal(securities.get("GAP"), null, "still queued");
        assert.deepEqual(storedDates(stored, "GAP"), ["2026-10-14", "2026-10-15", "2026-10-16"], "the 15th is not lost");
    });

    test("a history that simply ends (no later stored bars) is complete", async () => {
        const { store, securities } = fakeStore({ holdings: ["GONE"], queued: ["GONE"], bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }] });
        const { adapter } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            history: { GONE: [ohlc("2025-03-03T05:00:00.000Z", 5)] }, // delisted in March 2025
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(detail.backfilled, [{ symbol: "GONE", stored: 1, rejected: 0, historyStart: "2025-03-03" }]);
        assert.equal(securities.get("GONE"), "2025-03-03");
    });

    test("regression: symbols that keep failing move to the back, so the rest of the queue makes progress", async () => {
        // Ten held symbols; the first three always fail. The budget allows
        // only a few calls a run, which used to go to the same failures.
        const held = Array.from({ length: 10 }, (_, i) => `H${i}`);
        const failing = new Set(["H0", "H1", "H2"]);
        const { store, securities } = fakeStore({ holdings: held, queued: held, bars: [{ ...dailyBar("SPY", "2026-10-16"), source: "massive" }] });
        const history = Object.fromEntries(held.map((symbol) => [
            symbol,
            failing.has(symbol)
                ? new PolygonApiError(502, "Bad Gateway", `https://api.polygon.io/v2/aggs/ticker/${symbol}?apiKey=***`)
                : [ohlc("2026-10-15T04:00:00.000Z")],
        ]));

        const attemptsPerRun: string[][] = [];
        let clockStart = Date.parse(FRIDAY_EVENING);
        for (let run = 0; run < 3; run++) {
            const clock = fakeClock(new Date(clockStart).toISOString());
            const { adapter, calls } = fakeAdapter({ history });
            // A budget for five calls: one window, no waiting.
            await ingestDailyPrices({ adapter, store, now: clock.now, sleep: clock.sleep, budgetMs: 60_000 });
            attemptsPerRun.push(calls.filter((call) => call.startsWith("history")).map((call) => call.split(" ")[1]));
            clockStart += 24 * 60 * 60 * 1000;
        }

        assert.deepEqual(attemptsPerRun[0], ["H0", "H1", "H2", "H3", "H4"]);
        // Next runs take the never-tried first, then the failures, oldest attempt first.
        assert.deepEqual(attemptsPerRun[1], ["H5", "H6", "H7", "H8", "H9"]);
        assert.deepEqual(attemptsPerRun[2], ["H0", "H1", "H2"]);
        for (const symbol of held.filter((symbol) => !failing.has(symbol))) assert.notEqual(securities.get(symbol), null, `${symbol} never loaded`);
    });
});

describe("ingestDailyPrices › looked-up symbols", () => {
    test("history waits for a daily file to price a looked-up symbol; held ones go first", async () => {
        // OLDREAL and HELDFUND were tracked on the 1st; NEWJUNK by a lookup this morning.
        const { store, stored } = fakeStore({
            holdings: ["HELDFUND"],
            queued: ["OLDREAL", "NEWJUNK", "HELDFUND"],
            trackedAt: { OLDREAL: "2026-10-01T12:00:00Z", HELDFUND: "2026-10-01T12:00:00Z" },
            bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }],
        });
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16"), dailyBar("OLDREAL", "2026-10-16", 40)] },
            history: { OLDREAL: [ohlc("2026-10-15T04:00:00.000Z", 39)] },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        // HELDFUND (held, never in a daily file) first; OLDREAL once the 16th's
        // file priced it (so it isn't dropped either); never NEWJUNK.
        assert.deepEqual(calls.filter((call) => call.startsWith("history")), ["history HELDFUND 2Y", "history OLDREAL 2Y"]);
        // The history lags the daily file by a day: nothing is written until
        // it covers the 16th, and the 16th's bar stays.
        assert.deepEqual(storedDates(stored, "OLDREAL"), ["2026-10-16"]);
        // OLDREAL stays queued until a history covers the 16th; NEWJUNK waits
        // outside the queue until a daily file prices it.
        assert.equal(detail.backfillQueue, 1);
        assert.deepEqual(detail.backfilled?.find((entry) => entry.symbol === "OLDREAL")?.complete, false);
    });

    test("drops looked-up symbols no daily file priced within a week, never held or recent ones", async () => {
        const { store, securities } = fakeStore({
            holdings: ["HELDFUND"],
            queued: ["JUNK", "PRICED", "RECENT", "HELDFUND"],
            trackedAt: { JUNK: "2026-10-09T12:00:00Z", PRICED: "2026-10-01T12:00:00Z", HELDFUND: "2026-10-01T12:00:00Z", RECENT: "2026-10-10T12:00:00Z" },
            bars: [{ ...dailyBar("PRICED", "2026-10-16"), source: "massive" }],
        });
        const { adapter } = fakeAdapter();

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        // Grace is a week before Friday 22:30Z: JUNK (9th, 12:00Z) is past it, RECENT (10th) is not.
        assert.deepEqual(detail.pruned, ["JUNK"]);
        assert.equal(securities.has("JUNK"), false);
        for (const symbol of ["PRICED", "RECENT", "HELDFUND", ...BENCHMARK_SYMBOLS]) assert.ok(securities.has(symbol), `${symbol} was dropped`);
    });
});

describe("createIngestAdapter", () => {
    test("makes no retries of its own, so every request goes through the pacer", async () => {
        let requests = 0;
        const adapter = createIngestAdapter({
            fetch: (async () => {
                requests++;
                return new Response("{}", { status: 429, headers: { "Retry-After": "30" } });
            }) as typeof globalThis.fetch,
            now: () => new Date(FRIDAY_EVENING),
        }, "test-key");

        await assert.rejects(adapter.getDailyBars("2026-10-16"), PolygonRateLimitError);
        await assert.rejects(adapter.getHistoricalPrices("AAPL", "2Y"), PolygonRateLimitError);
        await assert.rejects(adapter.getSplits("2026-10-15", "2026-10-16"), PolygonRateLimitError);
        assert.equal(requests, 3);
    });
});

describe("held symbols query", () => {
    test("reads distinct symbols across every portfolio", () => {
        const { sql, params } = buildHeldSymbolsQuery().toSQL();
        assert.equal(sql, 'select distinct "symbol" from "holdings"');
        assert.deepEqual(params, []);
    });
});
