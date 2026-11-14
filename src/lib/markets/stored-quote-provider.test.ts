import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MarketDataNotConfiguredError, QuoteUnavailableError } from "@/lib/providers/errors";
import { PolygonRateLimitError } from "@/lib/providers/polygon-massive-adapter";
import type { MarketDataProvider, OHLC } from "@/types/market-data";

import type { LatestClose, PriceBarInput } from "./price-store";
import { quoteFromCloses, sessionCloseTime, StoredQuoteProvider, TRACKING_RETRY_MS, type QuoteStore } from "./stored-quote-provider";

function fakeStore(
    closes: Record<string, LatestClose[]>,
    options: {
        configured?: boolean;
        trackFails?: boolean;
        refuse?: (symbol: string) => boolean;
        /** Stored daily bars by symbol, oldest first. */
        bars?: Record<string, PriceBarInput[]>;
        barsFail?: boolean;
    } = {},
) {
    const tracked: string[][] = [];
    const reads: string[][] = [];
    const barReads: Array<{ symbol: string; from: string; to: string }> = [];
    const store: QuoteStore = {
        configured: () => options.configured ?? true,
        recentCloses: async (symbols) => {
            reads.push(symbols);
            return new Map(symbols.filter((s) => closes[s]).map((s) => [s, closes[s]]));
        },
        track: async (symbols) => {
            tracked.push(symbols);
            if (options.trackFails) throw new Error("database down");
            return { refused: symbols.filter((symbol) => options.refuse?.(symbol) ?? false) };
        },
        bars: async (symbol, from, to) => {
            barReads.push({ symbol, from, to });
            if (options.barsFail) throw new Error("database down");
            return (options.bars?.[symbol] ?? []).filter((bar) => bar.date >= from && bar.date <= to);
        },
    };
    return { store, tracked, reads, barReads };
}

const REFERENCE_BAR: OHLC = { timestamp: "2026-10-16T04:00:00.000Z", open: 1, high: 2, low: 1, close: 2, volume: 10 };

const reference = {
    getQuote: async () => { throw new Error("reference quotes must not be used"); },
    getBatchQuotes: async () => { throw new Error("reference quotes must not be used"); },
    getHistoricalPrices: async () => [REFERENCE_BAR],
    getFundamentals: async (symbol: string) => ({ symbol, name: "Ref" }),
    searchSymbol: async () => [{ symbol: "AAPL", name: "Apple", type: "CS", primaryExchange: "XNAS", active: true }],
} satisfies MarketDataProvider;

/** The reference provider (Massive), counting the history it is asked for. */
function countingReference(answer: () => Promise<OHLC[]> = async () => [REFERENCE_BAR]) {
    const asked: Array<[string, string]> = [];
    const provider: MarketDataProvider = {
        ...reference,
        getHistoricalPrices: async (symbol, range) => {
            asked.push([symbol, range]);
            return answer();
        },
    };
    return { provider, asked };
}

/** A stored daily bar with a close; the other prices follow it. */
function storedBar(symbol: string, date: string, close: number): PriceBarInput {
    return { symbol, date, open: close - 1, high: close + 1, low: close - 2, close, volume: 1_000, source: "massive" };
}

/** Every trading day's bar from `from` through `to` (weekdays; good enough for these windows). */
function weekdayBars(symbol: string, from: string, to: string): PriceBarInput[] {
    const bars: PriceBarInput[] = [];
    for (let day = new Date(`${from}T00:00:00Z`); day.toISOString().slice(0, 10) <= to; day.setUTCDate(day.getUTCDate() + 1)) {
        if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
        bars.push(storedBar(symbol, day.toISOString().slice(0, 10), 100 + bars.length));
    }
    return bars;
}

// Friday 13 November 2026, 5:00 PM EST: that day's session has closed.
const AFTER_FRIDAY_CLOSE = Date.parse("2026-11-13T22:00:00Z");

describe("quoteFromCloses", () => {
    test("prices the latest close and measures the change from the one before", () => {
        assert.deepEqual(quoteFromCloses("AAPL", [{ date: "2026-10-16", close: 252 }, { date: "2026-10-15", close: 250 }]), {
            symbol: "AAPL",
            price: 252,
            change: 2,
            changePercent: 0.8,
            timestamp: "2026-10-16T20:00:00.000Z",
            kind: "close",
            isRealtime: false,
        });
    });

    test("a first close has a price but no change; no positive close is no quote", () => {
        const first = quoteFromCloses("NEW", [{ date: "2026-10-16", close: 10 }]);
        assert.equal(first?.price, 10);
        assert.equal(first?.change, null);
        assert.equal(first?.changePercent, null);
        // A zero earlier close can't be compared with either.
        assert.equal(quoteFromCloses("NEW", [{ date: "2026-10-16", close: 10 }, { date: "2026-10-15", close: 0 }])?.changePercent, null);
        assert.equal(quoteFromCloses("BAD", [{ date: "2026-10-16", close: 0 }]), undefined);
        assert.equal(quoteFromCloses("NONE", []), undefined);
    });
});

describe("sessionCloseTime", () => {
    test("is 4:00 PM ET, or 1:00 PM on early-close days", () => {
        assert.equal(sessionCloseTime("2026-10-16"), "2026-10-16T20:00:00.000Z");
        assert.equal(sessionCloseTime("2026-11-27"), "2026-11-27T18:00:00.000Z");
        assert.equal(sessionCloseTime("2026-12-01"), "2026-12-01T21:00:00.000Z");
    });

    test("falls back to 4:00 PM EST outside the calendar's range", () => {
        assert.equal(sessionCloseTime("2016-05-02"), "2016-05-02T21:00:00.000Z");
    });
});

describe("StoredQuoteProvider", () => {
    test("answers quotes from the store and starts tracking the unpriced symbols", async () => {
        const { store, tracked, reads } = fakeStore({ AAPL: [{ date: "2026-10-16", close: 252 }, { date: "2026-10-15", close: 250 }] });
        const quotes = await new StoredQuoteProvider(reference, store).getBatchQuotes([" aapl", "MSFT", "AAPL", "AAPL260116C00250000"]);
        assert.deepEqual(quotes.map((q) => [q.symbol, q.price]), [["AAPL", 252]]);
        assert.deepEqual(reads, [["AAPL", "MSFT"]]);
        assert.deepEqual(tracked, [["MSFT"]]);
    });

    test("asks the store to track an unpriced symbol once, not on every poll", async () => {
        const { store, tracked } = fakeStore({});
        const provider = new StoredQuoteProvider(reference, store);
        await provider.getBatchQuotes(["BTC-USD", "MSFT"]);
        await provider.getBatchQuotes(["BTC-USD", "MSFT", "SPY"]);
        await provider.getBatchQuotes(["BTC-USD"]);
        assert.deepEqual(tracked, [["BTC-USD", "MSFT"], ["SPY"]]);
    });

    test("tries tracking again after a failed attempt", async () => {
        const { store, tracked } = fakeStore({}, { trackFails: true });
        const provider = new StoredQuoteProvider(reference, store);
        await provider.getBatchQuotes(["MSFT"]);
        await provider.getBatchQuotes(["MSFT"]);
        assert.deepEqual(tracked, [["MSFT"], ["MSFT"]]);
    });

    test("symbols refused for lack of room aren't remembered, and are asked for again later", async () => {
        // The store is full for NEW; MSFT was taken.
        let now = 0;
        const { store, tracked } = fakeStore({}, { refuse: (symbol) => symbol === "NEW" });
        const provider = new StoredQuoteProvider(reference, store, () => now);

        await provider.getBatchQuotes(["MSFT", "NEW"]);
        await provider.getBatchQuotes(["MSFT", "NEW"]); // full: no ask until the retry time
        now = TRACKING_RETRY_MS;
        await provider.getBatchQuotes(["MSFT", "NEW"]);

        assert.deepEqual(tracked, [["MSFT", "NEW"], ["NEW"]]);
    });

    test("still answers when tracking fails", async () => {
        const { store } = fakeStore({ AAPL: [{ date: "2026-10-16", close: 252 }] }, { trackFails: true });
        const quotes = await new StoredQuoteProvider(reference, store).getBatchQuotes(["AAPL", "MSFT"]);
        assert.deepEqual(quotes.map((q) => q.symbol), ["AAPL"]);
    });

    test("without a database it is not configured", async () => {
        const { store } = fakeStore({}, { configured: false });
        await assert.rejects(new StoredQuoteProvider(reference, store).getBatchQuotes(["AAPL"]), MarketDataNotConfiguredError);
    });

    test("a single quote with no stored price is unavailable", async () => {
        const { store } = fakeStore({});
        await assert.rejects(new StoredQuoteProvider(reference, store).getQuote("msft"), (err: unknown) =>
            err instanceof QuoteUnavailableError && err.symbol === "MSFT");
    });

    test("fundamentals and search go to the reference provider", async () => {
        const provider = new StoredQuoteProvider(reference, fakeStore({}).store);
        assert.equal((await provider.getFundamentals("AAPL")).name, "Ref");
        assert.equal((await provider.searchSymbol("apple"))[0].symbol, "AAPL");
    });
});

// x09: sparklines and thesis charts read the stored daily bars, not a
// Massive call per symbol that spends the shared five-a-minute budget.
describe("StoredQuoteProvider history (x09)", () => {
    test("regression: stored bars answer the range, and Massive is never asked", async () => {
        const massive = countingReference(async () => { throw new Error("Massive must not be called"); });
        const { store, barReads } = fakeStore({}, {
            bars: { AAPL: [storedBar("AAPL", "2026-11-12", 250), storedBar("AAPL", "2026-11-13", 252)] },
        });
        const bars = await new StoredQuoteProvider(massive.provider, store, () => AFTER_FRIDAY_CLOSE).getHistoricalPrices(" aapl", "1M");

        assert.deepEqual(massive.asked, []);
        assert.deepEqual(barReads, [{ symbol: "AAPL", from: "2026-10-14", to: "2026-11-13" }]);
        // The shape the routes always answered with: Massive's, a bar stamped
        // with midnight New York on its trading date, oldest first.
        assert.deepEqual(bars, [
            { timestamp: "2026-11-12T05:00:00.000Z", open: 249, high: 251, low: 248, close: 250, volume: 1_000 },
            { timestamp: "2026-11-13T05:00:00.000Z", open: 251, high: 253, low: 250, close: 252, volume: 1_000 },
        ]);
    });

    test("each range reads its own window: calendar days back from today, MAX two years", async () => {
        const { store, barReads } = fakeStore({}, { bars: { AAPL: weekdayBars("AAPL", "2024-11-01", "2026-11-13") } });
        const provider = new StoredQuoteProvider(countingReference().provider, store, () => AFTER_FRIDAY_CLOSE);
        for (const range of ["1M", "3M", "6M", "1Y", "MAX"]) await provider.getHistoricalPrices("AAPL", range);
        assert.deepEqual(barReads.map(({ from, to }) => [from, to]), [
            ["2026-10-14", "2026-11-13"],
            ["2026-08-15", "2026-11-13"],
            ["2026-05-17", "2026-11-13"],
            ["2025-11-13", "2026-11-13"],
            ["2024-11-13", "2026-11-13"],
        ]);
        // Nothing older than two years, however much is stored.
        const max = await provider.getHistoricalPrices("AAPL", "MAX");
        assert.equal(max[0].timestamp, "2024-11-13T05:00:00.000Z");
    });

    test("1D and 5D are the newest one and five stored sessions, through the last completed one", async () => {
        const { store } = fakeStore({}, { bars: { AAPL: weekdayBars("AAPL", "2026-10-01", "2026-11-13") } });
        const dates = (bars: OHLC[]) => bars.map((bar) => bar.timestamp.slice(0, 10));

        const afterClose = new StoredQuoteProvider(countingReference().provider, store, () => AFTER_FRIDAY_CLOSE);
        assert.deepEqual(dates(await afterClose.getHistoricalPrices("AAPL", "1D")), ["2026-11-13"]);
        assert.deepEqual(dates(await afterClose.getHistoricalPrices("AAPL", "5D")), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);

        // Before Friday's close, Thursday is the last session: a bar already
        // stored for Friday (none would be) is not counted.
        const beforeClose = new StoredQuoteProvider(countingReference().provider, store, () => Date.parse("2026-11-13T15:00:00Z"));
        assert.deepEqual(dates(await beforeClose.getHistoricalPrices("AAPL", "1D")), ["2026-11-12"]);
    });

    test("a session range keeps what is stored while the newest session isn't in yet", async () => {
        // The nightly ingest stores a session after its close: until then the
        // newest stored bar is the session before, as Massive's answer was.
        const { store } = fakeStore({}, { bars: { AAPL: weekdayBars("AAPL", "2026-10-01", "2026-11-12") } });
        const massive = countingReference();
        const bars = await new StoredQuoteProvider(massive.provider, store, () => AFTER_FRIDAY_CLOSE).getHistoricalPrices("AAPL", "1D");
        assert.deepEqual(bars.map((bar) => bar.timestamp), ["2026-11-12T05:00:00.000Z"]);
        assert.deepEqual(massive.asked, []);
    });

    test("no stored bar in the window: Massive answers, once, for that symbol and range", async () => {
        const massive = countingReference();
        // Bars from before the window don't count.
        const { store } = fakeStore({}, { bars: { THSS: [storedBar("THSS", "2026-01-05", 10)] } });
        const bars = await new StoredQuoteProvider(massive.provider, store, () => AFTER_FRIDAY_CLOSE).getHistoricalPrices("THSS", "1M");
        assert.deepEqual(bars, [REFERENCE_BAR]);
        assert.deepEqual(massive.asked, [["THSS", "1M"]]);
    });

    test("the fallback's rate limit reaches the route as it did (429), not as an empty chart", async () => {
        const massive = countingReference(async () => { throw new PolygonRateLimitError(30_000, "https://api.polygon.io/v2/aggs"); });
        const { store } = fakeStore({});
        await assert.rejects(
            new StoredQuoteProvider(massive.provider, store, () => AFTER_FRIDAY_CLOSE).getHistoricalPrices("NEW", "1M"),
            PolygonRateLimitError,
        );
    });

    test("a store that can't be read is an error, not a reason to spend Massive's budget", async () => {
        const massive = countingReference();
        const { store } = fakeStore({}, { barsFail: true });
        await assert.rejects(
            new StoredQuoteProvider(massive.provider, store, () => AFTER_FRIDAY_CLOSE).getHistoricalPrices("AAPL", "1M"),
            /database down/,
        );
        assert.deepEqual(massive.asked, []);
    });

    test("without a database, history goes to Massive as before", async () => {
        const massive = countingReference();
        const { store, barReads } = fakeStore({}, { configured: false });
        const bars = await new StoredQuoteProvider(massive.provider, store, () => AFTER_FRIDAY_CLOSE).getHistoricalPrices("AAPL", "1M");
        assert.deepEqual(bars, [REFERENCE_BAR]);
        assert.deepEqual(massive.asked, [["AAPL", "1M"]]);
        assert.deepEqual(barReads, []);
    });
});
