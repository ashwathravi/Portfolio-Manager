import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

import { MarketDataNotConfiguredError, QuoteUnavailableError } from "@/lib/providers/errors";
import { FinnhubAuthError, FinnhubRateLimitError, type IntradayQuote } from "@/lib/providers/finnhub-quote-client";
import type { MarketDataProvider, Quote } from "@/types/market-data";

import {
    AUTH_PAUSE_MS,
    DelayedQuoteProvider,
    quoteFromIntraday,
    RATE_LIMIT_PAUSE_MS,
    type IntradaySource,
    type IntradayStore,
} from "./delayed-quote-provider";
import { chooseClaims, type IntradayResult, type IntradayRow } from "./intraday-quotes";
import { sessionSoFar } from "./market-hours";
import { quoteFromCloses } from "./stored-quote-provider";

// Monday 2 November 2026, 10:42 AM EST. The session before was Friday 30 October.
const MONDAY_MORNING = Date.parse("2026-11-02T15:42:00Z");
const quotedAt = new Date("2026-11-02T15:41:30Z");

/** Stored closes: Friday's, and Thursday's before it. */
function closesProvider(closes: Record<string, [friday: number, thursday: number] | { today: number }>, configured = true) {
    const quote = (symbol: string): Quote | undefined => {
        const value = closes[symbol];
        if (!value) return undefined;
        if ("today" in value) return quoteFromCloses(symbol, [{ date: "2026-11-02", close: value.today }, { date: "2026-10-30", close: value.today }]);
        return quoteFromCloses(symbol, [{ date: "2026-10-30", close: value[0] }, { date: "2026-10-29", close: value[1] }]);
    };
    return {
        getBatchQuotes: async (symbols: string[]) => {
            if (!configured) throw new MarketDataNotConfiguredError("DATABASE_URL");
            return symbols.map((s) => s.trim().toUpperCase()).flatMap((s) => quote(s) ?? []);
        },
        getQuote: async () => { throw new Error("unused"); },
        getHistoricalPrices: async () => [],
        getFundamentals: async (symbol: string) => ({ symbol, name: "Ref" }),
        searchSymbol: async () => [],
    } satisfies MarketDataProvider;
}

function fakeSource(answers: Record<string, IntradayQuote | null | Error>, configured = true) {
    const calls: string[] = [];
    const source: IntradaySource = {
        source: "finnhub",
        configured: () => configured,
        quote: async (symbol) => {
            calls.push(symbol);
            const answer = answers[symbol];
            if (answer instanceof Error) throw answer;
            return answer ?? null;
        },
    };
    return { source, calls };
}

/** The shared rows, with the real claim rules; `tracked` are the securities the store knows. */
function fakeStore(tracked: string[], options: { configured?: boolean; fails?: boolean } = {}) {
    const rows = new Map<string, IntradayRow>();
    const saves: IntradayResult[][] = [];
    const blank = (symbol: string): IntradayRow => ({ symbol, price: null, previousClose: null, quotedAt: null, claimedAt: null, fetchedAt: null });
    const current = (symbols: readonly string[]) => symbols.filter((s) => tracked.includes(s)).map((s) => rows.get(s) ?? blank(s));
    const store: IntradayStore = {
        configured: () => options.configured ?? true,
        read: async (symbols) => {
            if (options.fails) throw new Error("database down");
            return current(symbols);
        },
        claim: async (symbols, { now, session, budget }) => {
            const used = [...rows.values()].filter((r) => r.claimedAt && r.claimedAt.getTime() > now.getTime() - budget.windowMs).length;
            const before = current(symbols);
            const claimed = chooseClaims(before, budget.limit - used, now, session);
            for (const symbol of claimed) rows.set(symbol, { ...(rows.get(symbol) ?? blank(symbol)), claimedAt: now });
            return { rows: before, claimed };
        },
        save: async (results, { claimedAt, fetchedAt }) => {
            saves.push([...results]);
            for (const { symbol, quote } of results) {
                rows.set(symbol, {
                    symbol,
                    price: quote?.price ?? null,
                    previousClose: quote?.previousClose ?? null,
                    quotedAt: quote?.quotedAt ?? null,
                    claimedAt,
                    fetchedAt,
                });
            }
        },
    };
    return { store, rows, saves };
}

function clock(start = MONDAY_MORNING) {
    let now = start;
    return { now: () => now, advance: (ms: number) => { now += ms; } };
}

let warnings: string[] = [];
beforeEach(() => {
    warnings = [];
    mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); });
});
afterEach(() => mock.restoreAll());

describe("DelayedQuoteProvider", () => {
    test("during the session a stored close becomes a delayed quote from today", async () => {
        const { source, calls } = fakeSource({ AAPL: { price: 231.5, previousClose: 230, quotedAt } });
        const { store } = fakeStore(["AAPL"]);
        const provider = new DelayedQuoteProvider(closesProvider({ AAPL: [230, 228] }), source, store, clock().now);

        assert.deepEqual(await provider.getBatchQuotes(["aapl"]), [{
            symbol: "AAPL",
            price: 231.5,
            change: 1.5,
            changePercent: (1.5 / 230) * 100,
            timestamp: "2026-11-02T15:41:30.000Z",
            kind: "delayed",
            isRealtime: false,
        }]);
        assert.deepEqual(calls, ["AAPL"]);
    });

    test("serves the shared quote for a minute, then fetches it again", async () => {
        const { source, calls } = fakeSource({ AAPL: { price: 231.5, previousClose: 230, quotedAt } });
        const { store } = fakeStore(["AAPL"]);
        const time = clock();
        const provider = new DelayedQuoteProvider(closesProvider({ AAPL: [230, 228] }), source, store, time.now);
        // Another instance sharing the same rows.
        const other = new DelayedQuoteProvider(closesProvider({ AAPL: [230, 228] }), source, store, time.now);

        await provider.getBatchQuotes(["AAPL"]);
        time.advance(30_000);
        assert.equal((await other.getBatchQuotes(["AAPL"]))[0].kind, "delayed");
        assert.deepEqual(calls, ["AAPL"]);

        time.advance(30_000);
        await other.getBatchQuotes(["AAPL"]);
        assert.deepEqual(calls, ["AAPL", "AAPL"]);
    });

    test("keeps the close before the open, on weekends, and once today's close is stored", async () => {
        const { source, calls } = fakeSource({ AAPL: { price: 231.5, previousClose: 230, quotedAt } });
        const closes = closesProvider({ AAPL: [230, 228], MSFT: { today: 500 } });
        for (const at of ["2026-11-02T14:29:00Z", "2026-10-31T16:00:00Z"]) {
            const provider = new DelayedQuoteProvider(closes, source, fakeStore(["AAPL"]).store, () => Date.parse(at));
            assert.equal((await provider.getBatchQuotes(["AAPL"]))[0].kind, "close", at);
        }
        const provider = new DelayedQuoteProvider(closes, source, fakeStore(["AAPL", "MSFT"]).store, clock().now);
        assert.equal((await provider.getBatchQuotes(["MSFT"]))[0].timestamp, "2026-11-02T21:00:00.000Z");
        assert.deepEqual(calls, []);
    });

    test("without a key or a database it is the stored closes, and asks nobody", async () => {
        const { source, calls } = fakeSource({ AAPL: { price: 231.5, previousClose: 230, quotedAt } }, false);
        const unkeyed = new DelayedQuoteProvider(closesProvider({ AAPL: [230, 228] }), source, fakeStore(["AAPL"]).store, clock().now);
        assert.equal((await unkeyed.getBatchQuotes(["AAPL"]))[0].kind, "close");
        assert.deepEqual(calls, []);

        const noDatabase = new DelayedQuoteProvider(closesProvider({}, false), fakeSource({}).source, fakeStore([]).store, clock().now);
        await assert.rejects(noDatabase.getBatchQuotes(["AAPL"]), MarketDataNotConfiguredError);
    });

    test("never asks for crypto pairs or symbols the price store doesn't track", async () => {
        const { source, calls } = fakeSource({});
        const provider = new DelayedQuoteProvider(closesProvider({}), source, fakeStore(["AAPL"]).store, clock().now);

        assert.deepEqual(await provider.getBatchQuotes(["BTC-USD", "NOTTRACKED"]), []);
        assert.deepEqual(calls, []);
    });

    test("a tracked symbol with no stored close yet is priced from its delayed quote", async () => {
        const { source } = fakeSource({ NEWCO: { price: 12, previousClose: 11, quotedAt } });
        const provider = new DelayedQuoteProvider(closesProvider({}), source, fakeStore(["NEWCO"]).store, clock().now);

        const quote = await provider.getQuote("newco");
        assert.equal(quote.price, 12);
        assert.equal(quote.kind, "delayed");
        await assert.rejects(provider.getQuote("NONE"), QuoteUnavailableError);
    });

    test("stays within the call budget, and gives every symbol its turn", async () => {
        const answers = Object.fromEntries(["A", "B", "C"].map((s) => [s, { price: 10, previousClose: 10, quotedAt }]));
        const { source, calls } = fakeSource(answers);
        const time = clock();
        const provider = new DelayedQuoteProvider(
            closesProvider({ A: [10, 10], B: [10, 10], C: [10, 10] }),
            source,
            fakeStore(["A", "B", "C"]).store,
            time.now,
            { limit: 2, windowMs: 61_000 },
        );

        const first = await provider.getBatchQuotes(["A", "B", "C"]);
        assert.deepEqual(first.map((q) => [q.symbol, q.kind]), [["A", "delayed"], ["B", "delayed"], ["C", "close"]]);
        assert.deepEqual(calls, ["A", "B"]);

        time.advance(61_000);
        await provider.getBatchQuotes(["A", "B", "C"]);
        assert.deepEqual(calls.slice(2), ["C", "A"]);
    });

    test("a symbol the provider doesn't know keeps its close and isn't asked about for ten minutes", async () => {
        const { source, calls } = fakeSource({ XYZ: null });
        const time = clock();
        const provider = new DelayedQuoteProvider(closesProvider({ XYZ: [5, 5] }), source, fakeStore(["XYZ"]).store, time.now);

        assert.equal((await provider.getBatchQuotes(["XYZ"]))[0].kind, "close");
        time.advance(9 * 60_000);
        await provider.getBatchQuotes(["XYZ"]);
        assert.deepEqual(calls, ["XYZ"]);
        time.advance(60_000);
        await provider.getBatchQuotes(["XYZ"]);
        assert.deepEqual(calls, ["XYZ", "XYZ"]);
    });

    test("regression: a previous close that disagrees with the stored one (a split) keeps the close", async () => {
        // The stock split 2-for-1 before Monday's open; the ingest hasn't seen it yet.
        const { source } = fakeSource({ NVDA: { price: 101, previousClose: 100, quotedAt } });
        const provider = new DelayedQuoteProvider(closesProvider({ NVDA: [200, 198] }), source, fakeStore(["NVDA"]).store, clock().now);

        const [quote] = await provider.getBatchQuotes(["NVDA"]);
        assert.equal(quote.kind, "close");
        assert.equal(quote.price, 200);
    });

    test("after a 429 this instance asks again only after a minute, showing closes meanwhile", async () => {
        const answers: Record<string, IntradayQuote | Error> = { AAPL: new FinnhubRateLimitError() };
        const { source, calls } = fakeSource(answers);
        const time = clock();
        const provider = new DelayedQuoteProvider(closesProvider({ AAPL: [230, 228] }), source, fakeStore(["AAPL"]).store, time.now);

        assert.equal((await provider.getBatchQuotes(["AAPL"]))[0].kind, "close");
        answers.AAPL = { price: 231.5, previousClose: 230, quotedAt };
        time.advance(RATE_LIMIT_PAUSE_MS - 1_000);
        await provider.getBatchQuotes(["AAPL"]);
        assert.deepEqual(calls, ["AAPL"]);
        time.advance(1_000);
        assert.equal((await provider.getBatchQuotes(["AAPL"]))[0].kind, "delayed");
        assert.match(warnings.join("\n"), /rate limit/);
    });

    test("a refused key pauses for ten minutes, and the warning never contains it", async () => {
        const { source, calls } = fakeSource({ AAPL: new FinnhubAuthError(401) });
        const time = clock();
        const provider = new DelayedQuoteProvider(closesProvider({ AAPL: [230, 228] }), source, fakeStore(["AAPL"]).store, time.now);

        await provider.getBatchQuotes(["AAPL"]);
        time.advance(AUTH_PAUSE_MS - 1_000);
        await provider.getBatchQuotes(["AAPL"]);
        assert.deepEqual(calls, ["AAPL"]);
        assert.match(warnings.join("\n"), /refused the API key \(HTTP 401\)/);
    });

    test("a failed fetch or a database error leaves the closes", async () => {
        const failing = new DelayedQuoteProvider(
            closesProvider({ AAPL: [230, 228] }),
            fakeSource({ AAPL: new Error("socket hang up") }).source,
            fakeStore(["AAPL"]).store,
            clock().now,
        );
        assert.equal((await failing.getBatchQuotes(["AAPL"]))[0].kind, "close");

        const down = new DelayedQuoteProvider(
            closesProvider({ AAPL: [230, 228] }),
            fakeSource({}).source,
            fakeStore(["AAPL"], { fails: true }).store,
            clock().now,
        );
        assert.equal((await down.getBatchQuotes(["AAPL"]))[0].kind, "close");
        assert.match(warnings.join("\n"), /1 symbol\(s\)[\s\S]*database down/);
    });

    test("keeps the order asked for, mixing delayed quotes and closes", async () => {
        const { source } = fakeSource({ MSFT: { price: 510, previousClose: 500, quotedAt } });
        const provider = new DelayedQuoteProvider(closesProvider({ AAPL: [230, 228], MSFT: [500, 490] }), source, fakeStore(["MSFT"]).store, clock().now);

        const quotes = await provider.getBatchQuotes(["MSFT", "AAPL"]);
        assert.deepEqual(quotes.map((q) => [q.symbol, q.kind]), [["MSFT", "delayed"], ["AAPL", "close"]]);
    });
});

describe("quoteFromIntraday", () => {
    const now = new Date(MONDAY_MORNING);
    const session = sessionSoFar(now)!;
    const stored = (overrides: Partial<IntradayRow>): IntradayRow => ({
        symbol: "AAPL", price: 231.5, previousClose: 230, quotedAt, claimedAt: now, fetchedAt: now, ...overrides,
    });

    test("ignores a quote from before today's open, or ahead of the clock", () => {
        assert.equal(quoteFromIntraday(stored({ quotedAt: new Date("2026-10-30T20:59:00Z") }), session, now), undefined);
        assert.equal(quoteFromIntraday(stored({ quotedAt: new Date("2026-11-02T14:29:59Z") }), session, now), undefined);
        assert.equal(quoteFromIntraday(stored({ quotedAt: new Date("2026-11-02T15:45:00Z") }), session, now), undefined);
        assert.equal(quoteFromIntraday(stored({}), session, now)?.kind, "delayed");
    });

    test("needs a price and a previous close", () => {
        assert.equal(quoteFromIntraday(stored({ price: null }), session, now), undefined);
        assert.equal(quoteFromIntraday(stored({ previousClose: 0 }), session, now), undefined);
    });

    test("compares the previous close only with Friday's stored close, within 2%", () => {
        const friday = quoteFromCloses("AAPL", [{ date: "2026-10-30", close: 234.5 }])!;
        assert.equal(quoteFromIntraday(stored({}), session, now, friday)?.kind, "delayed"); // 1.96% apart
        const off = quoteFromCloses("AAPL", [{ date: "2026-10-30", close: 235 }])!;
        assert.equal(quoteFromIntraday(stored({}), session, now, off), undefined); // 2.13% apart
        // An older close (the ingest missed Friday) can't be compared.
        const older = quoteFromCloses("AAPL", [{ date: "2026-10-28", close: 250 }])!;
        assert.equal(quoteFromIntraday(stored({}), session, now, older)?.kind, "delayed");
    });
});
