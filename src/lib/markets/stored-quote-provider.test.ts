import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MarketDataNotConfiguredError, QuoteUnavailableError } from "@/lib/providers/errors";
import type { MarketDataProvider } from "@/types/market-data";

import type { LatestClose } from "./price-store";
import { quoteFromCloses, sessionCloseTime, StoredQuoteProvider, type QuoteStore } from "./stored-quote-provider";

function fakeStore(closes: Record<string, LatestClose[]>, options: { configured?: boolean; trackFails?: boolean } = {}) {
    const tracked: string[][] = [];
    const reads: string[][] = [];
    const store: QuoteStore = {
        configured: () => options.configured ?? true,
        recentCloses: async (symbols) => {
            reads.push(symbols);
            return new Map(symbols.filter((s) => closes[s]).map((s) => [s, closes[s]]));
        },
        track: async (symbols) => {
            tracked.push(symbols);
            if (options.trackFails) throw new Error("database down");
        },
    };
    return { store, tracked, reads };
}

const reference = {
    getQuote: async () => { throw new Error("reference quotes must not be used"); },
    getBatchQuotes: async () => { throw new Error("reference quotes must not be used"); },
    getHistoricalPrices: async () => [{ timestamp: "2026-10-16T04:00:00.000Z", open: 1, high: 2, low: 1, close: 2, volume: 10 }],
    getFundamentals: async (symbol: string) => ({ symbol, name: "Ref" }),
    searchSymbol: async () => [{ symbol: "AAPL", name: "Apple", type: "CS", primaryExchange: "XNAS", active: true }],
} satisfies MarketDataProvider;

describe("quoteFromCloses", () => {
    test("prices the latest close and measures the change from the one before", () => {
        assert.deepEqual(quoteFromCloses("AAPL", [{ date: "2026-10-16", close: 252 }, { date: "2026-10-15", close: 250 }]), {
            symbol: "AAPL",
            price: 252,
            change: 2,
            changePercent: 0.8,
            timestamp: "2026-10-16T20:00:00.000Z",
            isRealtime: false,
        });
    });

    test("a first close reads as unchanged; no positive close is no quote", () => {
        assert.equal(quoteFromCloses("NEW", [{ date: "2026-10-16", close: 10 }])?.change, 0);
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

    test("history, fundamentals and search go to the reference provider", async () => {
        const provider = new StoredQuoteProvider(reference, fakeStore({}).store);
        assert.equal((await provider.getHistoricalPrices("AAPL", "1M")).length, 1);
        assert.equal((await provider.getFundamentals("AAPL")).name, "Ref");
        assert.equal((await provider.searchSymbol("apple"))[0].symbol, "AAPL");
    });
});
