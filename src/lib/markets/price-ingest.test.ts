import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    PolygonApiError,
    PolygonRateLimitError,
    type DailyBar,
    type SplitEvent,
} from "@/lib/providers/polygon-massive-adapter";
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
    splits = [],
    onCall,
}: {
    configured?: boolean;
    daily?: Record<string, DailyBar[] | Error>;
    history?: Record<string, OHLC[] | Error>;
    /** Every split the "provider" knows; answers are cut to the asked range. */
    splits?: SplitEvent[] | Error;
    onCall?: () => void;
} = {}) {
    const calls: string[] = [];
    const adapter: PriceIngestAdapter = {
        isConfigured: configured,
        async getDailyBars(date) {
            calls.push(`daily ${date}`);
            onCall?.();
            const value = daily[date];
            if (value instanceof Error) throw value;
            return new Map((value ?? []).map((bar) => [bar.symbol, bar]));
        },
        async getHistoricalPrices(symbol, range) {
            calls.push(`history ${symbol} ${range}`);
            onCall?.();
            const value = history[symbol];
            if (value instanceof Error) throw value;
            return value ?? [];
        },
        async getSplits(from, to) {
            calls.push(`splits ${from} ${to}`);
            onCall?.();
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
}: {
    holdings?: string[];
    /** Tracked symbols whose history is already loaded. */
    loaded?: string[];
    /** Tracked symbols still waiting for history. */
    queued?: string[];
    bars?: PriceBarInput[];
    /** When a symbol started being tracked; default the morning of the run. */
    trackedAt?: Record<string, string>;
} = {}) {
    const securities = new Map<string, string | null>([
        ...loaded.map((symbol) => [symbol, "2024-10-16"] as const),
        ...queued.map((symbol) => [symbol, null] as const),
    ]);
    const created = new Map([...securities.keys()].map((symbol) => [symbol, Date.parse(trackedAt[symbol] ?? "2026-10-16T12:00:00Z")]));
    const stored = new Map(bars.map((bar) => [`${bar.symbol}|${bar.date}`, bar]));
    const marks: Array<[string, string]> = [];
    const resets: string[] = [];
    const hasBars = (symbol: string) => [...stored.values()].some((bar) => bar.symbol === symbol);
    const queue = (priority: readonly string[]) => {
        const waiting = [...securities].filter(([symbol, start]) => start === null && (priority.includes(symbol) || hasBars(symbol)));
        return [...waiting.filter(([symbol]) => priority.includes(symbol)), ...waiting.filter(([symbol]) => !priority.includes(symbol))]
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
                .filter(([symbol, start]) => start === null && !keep.includes(symbol) && !hasBars(symbol)
                    && (created.get(symbol) ?? 0) < trackedBefore.getTime())
                .map(([symbol]) => symbol);
            for (const symbol of dropped) securities.delete(symbol);
            return dropped;
        },
        async markHistoryLoaded(symbol, startDate) {
            securities.set(symbol, startDate);
            marks.push([symbol, startDate]);
        },
        async replaceHistory(symbol, input, through) {
            const own = input.filter((bar) => bar.symbol === symbol && bar.date <= through);
            const valid = dedupeBars(own.filter(isValidBar));
            if (valid.length === 0) return undefined;
            const historyEnd = valid.map((bar) => bar.date).sort().at(-1)!;
            for (const [key, bar] of stored) if (bar.symbol === symbol && bar.date <= historyEnd) stored.delete(key);
            for (const bar of valid) stored.set(`${bar.symbol}|${bar.date}`, bar);
            const historyStart = valid.map((bar) => bar.date).sort()[0];
            securities.set(symbol, historyStart);
            marks.push([symbol, historyStart]);
            return { stored: valid.length, rejected: input.length - own.filter(isValidBar).length, historyStart };
        },
        async resetHistory(symbols) {
            const reset = normalizeSymbols(symbols).filter((symbol) => securities.get(symbol));
            for (const symbol of reset) securities.set(symbol, null);
            resets.push(...reset);
            return reset;
        },
    };
    return { store, securities, stored, marks, resets };
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

        assert.equal(calls[0], "daily 2026-10-16");
        assert.equal(calls.filter((call) => call.startsWith("daily")).length, 1);
        // Nothing stored yet, so no history on an old scale to fix.
        assert.deepEqual(detail.splits, { skipped: "first run" });
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

        assert.deepEqual(calls, ["splits 2026-10-14 2026-10-16", "daily 2026-10-14", "daily 2026-10-15", "history AAPL 2Y"]);
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
                    { ...ohlc("2026-10-15T04:00:00.000Z"), high: 1 }, // inconsistent: rejected
                ],
            },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(storedDates(stored, "AAPL"), ["2024-10-17", "2026-01-05", "2026-10-16"]);
        assert.deepEqual(marks, [["AAPL", "2024-10-17"]]);
        assert.equal(securities.get("AAPL"), "2024-10-17");
        assert.deepEqual(detail.backfilled, [{ symbol: "AAPL", stored: 3, rejected: 1, historyStart: "2024-10-17" }]);
        assert.equal(detail.backfillQueue, 0);
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
        // would open at 130 s, past the 100 s budget.
        assert.deepEqual(clock.sleeps, [60_000]);
        assert.equal(calls.length, 10);
        assert.equal(detail.calls, 10);
        assert.equal(detail.backfilled?.length, 9);
        assert.equal(detail.stopped?.backfill, "budget");
        assert.equal(detail.backfillQueue, 11);
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

    test("a rate limit during the backfill stops it for this run without failing", async () => {
        const { store, marks } = fakeStore({ holdings: ["AAA", "BBB", "CCC", "DDD"], queued: ["AAA", "BBB", "CCC", "DDD"] });
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            history: { CCC: new PolygonRateLimitError(1_000, "https://api.polygon.io/v2/aggs/ticker/CCC") },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(calls.slice(1), ["history AAA 2Y", "history BBB 2Y", "history CCC 2Y"]);
        assert.deepEqual(marks.map(([symbol]) => symbol), ["AAA", "BBB"]);
        assert.equal(detail.stopped?.backfill, "rate-limited");
        assert.equal(detail.backfillQueue, 2);
    });

    test("a rate limit during the catch-up ends the run's calls without failing", async () => {
        const { store } = fakeStore({ holdings: ["AAA"], queued: ["AAA"], bars: [{ ...dailyBar("SPY", "2026-10-14"), source: "massive" }] });
        const { adapter, calls } = fakeAdapter({
            daily: {
                "2026-10-15": [dailyBar("SPY", "2026-10-15")],
                "2026-10-16": new PolygonRateLimitError(1_000, "https://api.polygon.io/v2/aggs/grouped"),
            },
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(calls, ["splits 2026-10-15 2026-10-16", "daily 2026-10-15", "daily 2026-10-16"]);
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
        assert.deepEqual(detail.splits, { from: "2026-10-15", to: "2026-10-16", reset: ["NVDA"] });
        assert.deepEqual(resets, ["NVDA"]);
        // Only the adjusted history is left: the old-scale bars are gone, the 14th is rescaled.
        assert.deepEqual(storedDates(stored, "NVDA"), ["2024-10-17", "2026-10-14", "2026-10-15", "2026-10-16"]);
        assert.equal(stored.get("NVDA|2026-10-14")?.close, 100);
        assert.equal(securities.get("NVDA"), "2024-10-17");
        // AAPL didn't split.
        assert.equal(stored.get("AAPL|2026-10-14")?.close, 250);
        assert.equal(securities.get("AAPL"), "2024-10-16");
        assert.equal(detail.backfillQueue, 0);
    });

    test("a split on a day not stored yet is handled by the run that stores it", async () => {
        const { store, resets, securities } = fakeStore({
            holdings: ["NVDA"],
            loaded: [...BENCHMARK_SYMBOLS, "NVDA"],
            bars: [{ ...dailyBar("SPY", "2026-10-14"), source: "massive" }],
        });
        const splits = [{ symbol: "NVDA", executionDate: "2026-10-16" }];
        const unpublished = fakeAdapter({ splits, daily: { "2026-10-15": [dailyBar("SPY", "2026-10-15")], "2026-10-16": [] } });

        const first = await ingestDailyPrices({ adapter: unpublished.adapter, store, ...fakeClock() });

        assert.deepEqual(first.splits, { from: "2026-10-15", to: "2026-10-15", reset: [] });
        assert.equal(securities.get("NVDA"), "2024-10-16");

        const published = fakeAdapter({ splits, daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] } });
        const second = await ingestDailyPrices({ adapter: published.adapter, store, ...fakeClock() });

        assert.equal(published.calls[0], "splits 2026-10-16 2026-10-16");
        assert.deepEqual(second.splits, { from: "2026-10-16", to: "2026-10-16", reset: ["NVDA"] });
        assert.deepEqual(resets, ["NVDA"]);
        assert.ok(published.calls.includes("history NVDA 2Y"));
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

    test("a rate-limited split check ends the run's calls and stores nothing", async () => {
        const { store, stored } = fakeStore({ holdings: ["AAA"], queued: ["AAA"], bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }] });
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            splits: new PolygonRateLimitError(1_000, "https://api.polygon.io/v3/reference/splits?apiKey=***"),
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(calls, ["splits 2026-10-16 2026-10-16"]);
        assert.deepEqual(detail.stopped, { catchUp: "rate-limited", backfill: "rate-limited" });
        assert.deepEqual(detail.days, []);
        assert.deepEqual(detail.splits, { skipped: "rate-limited" });
        assert.equal(detail.daysBehind, 1);
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-15"]);
    });

    test("splits not on the plan (403) don't hold up prices", async () => {
        const { store, stored } = fakeStore({ bars: [{ ...dailyBar("SPY", "2026-10-15"), source: "massive" }] });
        const { adapter, calls } = fakeAdapter({
            daily: { "2026-10-16": [dailyBar("SPY", "2026-10-16")] },
            splits: new PolygonApiError(403, "Forbidden", "https://api.polygon.io/v3/reference/splits?apiKey=***"),
        });

        const detail = await ingestDailyPrices({ adapter, store, ...fakeClock() });

        assert.deepEqual(calls, ["splits 2026-10-16 2026-10-16", "daily 2026-10-16"]);
        assert.deepEqual(storedDates(stored, "SPY"), ["2026-10-15", "2026-10-16"]);
        assert.match((detail.splits as { skipped: string }).skipped, /HTTP 403 Forbidden/);
        assert.doesNotMatch((detail.splits as { skipped: string }).skipped, /apiKey=(?!\*)/);
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
        // The history lags the daily file by a day: the 16th's bar is kept, not replaced away.
        assert.deepEqual(storedDates(stored, "OLDREAL"), ["2026-10-15", "2026-10-16"]);
        assert.equal(detail.backfillQueue, 0, "NEWJUNK waits outside the queue until a daily file prices it");
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
