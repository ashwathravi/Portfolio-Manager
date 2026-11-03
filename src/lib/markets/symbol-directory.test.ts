import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { drizzle } from "drizzle-orm/postgres-js";

import type { SecExchangeTicker } from "@/lib/sec/edgar-client";
import type { TickerMatch } from "@/types/market-data";

import {
    buildBenchmarkSymbolsQuery,
    buildDirectorySearchQuery,
    buildHeldSymbolsQuery,
    buildUpsertDirectoryQuery,
    directoryEntries,
    directoryName,
    directoryTicker,
    exchangeName,
    MIN_DIRECTORY_SIZE,
    rankTickerMatches,
    refreshSymbolDirectory,
} from "./symbol-directory";
import { parseTickerQuery } from "./ticker-search";

const sec = (ticker: string, name: string, exchange: string | null = "Nasdaq", cik = "0000320193"): SecExchangeTicker =>
    ({ ticker, name, exchange, cik });
const match = (symbol: string, name: string, overrides: Partial<TickerMatch> = {}): TickerMatch =>
    ({ symbol, name, exchange: "Nasdaq", held: false, ...overrides });
const query = (raw: string) => parseTickerQuery(raw)!;

describe("directory entries from SEC's ticker file", () => {
    test("class shares are written as the app writes them; preferreds, warrants and units are left out", () => {
        assert.equal(directoryTicker("AAPL"), "AAPL");
        assert.equal(directoryTicker("BRK-B"), "BRK.B");
        assert.equal(directoryTicker("mog-a"), "MOG.A");
        assert.equal(directoryTicker("BAC-PQ"), null);
        assert.equal(directoryTicker("UAC-WT"), null);
        assert.equal(directoryTicker("YCY-UN"), null);
        assert.equal(directoryTicker("TOOLONG"), null);
    });

    test("names lose SEC's state-of-incorporation suffix", () => {
        assert.equal(directoryName("BANK OF AMERICA CORP /DE/"), "BANK OF AMERICA CORP");
        assert.equal(directoryName("SOMETHING INC /MD"), "SOMETHING INC");
        assert.equal(directoryName("Apple Inc."), "Apple Inc.");
    });

    test("one row per symbol, the first SEC lists", () => {
        const entries = directoryEntries([
            sec("BRK-B", "BERKSHIRE HATHAWAY INC", "NYSE", "0001067983"),
            sec("BAC-PQ", "BANK OF AMERICA CORP /DE/", "NYSE"),
            sec("GOOGL", "Alphabet Inc."),
            sec("GOOGL", "Alphabet Inc. (again)"),
            sec("NEWCO", "New Co", null),
        ]);
        // Each keeps its place in SEC's file, largest companies first.
        assert.deepEqual(entries, [
            { symbol: "BRK.B", name: "BERKSHIRE HATHAWAY INC", exchange: "NYSE", cik: "0001067983", position: 0 },
            { symbol: "GOOGL", name: "Alphabet Inc.", exchange: "Nasdaq", cik: "0000320193", position: 2 },
            { symbol: "NEWCO", name: "New Co", exchange: null, cik: "0000320193", position: 4 },
        ]);
    });

    test("exchange codes read as people know them", () => {
        assert.equal(exchangeName("ARCX"), "NYSE Arca");
        assert.equal(exchangeName("XNAS"), "Nasdaq");
        assert.equal(exchangeName("XOTC"), "XOTC");
        assert.equal(exchangeName(""), null);
        assert.equal(exchangeName(null), null);
    });
});

describe("ranking matches", () => {
    test("orders by rank, then the user's holdings, then listed before OTC, then larger companies, then shorter tickers", () => {
        const ranked = rankTickerMatches([
            { ...match("APPLY", "Apply Co", { exchange: "OTC" }), position: 1 },
            { ...match("APPN", "Appian Corp"), position: 900 },
            match("APPS", "Digital Turbine", { held: true }),
            { ...match("AAPL", "Apple Inc."), position: 0 },
            { ...match("APPF", "AppFolio Inc", { exchange: null }), position: 5 },
            { ...match("APPX", "Appx Corp"), position: 300 },
        ], query("app"));
        // OTC and unlisted alike come after listed ones, larger first.
        assert.deepEqual(ranked.map((m) => m.symbol), ["APPS", "APPX", "APPN", "APPLY", "APPF", "AAPL"]);
        // What comes back is the match alone.
        assert.deepEqual(Object.keys(ranked[1]).sort(), ["exchange", "held", "name", "symbol"]);
    });

    test("regression: a name everyone means comes before smaller companies with shorter tickers", () => {
        // "micro" was MU, HOLO, MBOT... with Microsoft seventh.
        const ranked = rankTickerMatches([
            { ...match("MU", "MICRON TECHNOLOGY INC"), position: 11 },
            { ...match("HOLO", "MicroCloud Hologram Inc."), position: 5477 },
            { ...match("MSFT", "MICROSOFT CORP"), position: 2 },
        ], query("micro"));
        assert.deepEqual(ranked.map((m) => m.symbol), ["MSFT", "MU", "HOLO"]);
    });

    test("a symbol in the directory and the user's holdings appears once, held, with the directory's name", () => {
        const ranked = rankTickerMatches([
            { ...match("SPY", "SPDR S&P 500 ETF TRUST", { exchange: "NYSE" }), position: 6876 },
            match("SPY", "SPDR S&P 500", { exchange: null, held: true }),
        ], query("spy"));
        assert.deepEqual(ranked, [match("SPY", "SPDR S&P 500 ETF TRUST", { exchange: "NYSE", held: true })]);
    });

    test("stops at the limit and leaves out what doesn't match", () => {
        const many = Array.from({ length: 12 }, (_, i) => match(`A${i}`, `Alpha ${i}`));
        assert.equal(rankTickerMatches(many, query("a")).length, 8);
        assert.deepEqual(rankTickerMatches([match("MSFT", "Microsoft Corp")], query("apple")), []);
    });
});

describe("ticker search queries", () => {
    // Builds SQL only; nothing connects.
    const database = drizzle.mock();

    test("the directory query ranks in SQL as rankTickerMatches does, OTC and unlisted last", () => {
        const { sql, params } = buildDirectorySearchQuery(query("brk b"), 8, database).toSQL();
        assert.match(sql, /when "symbol_directory"\."symbol" = \$\d+ then 0 when "symbol_directory"\."symbol" like \$\d+ then 1/);
        assert.match(sql, /order by case [\s\S]* end, \("symbol_directory"\."exchange" is null or "symbol_directory"\."exchange" = 'OTC'\), "symbol_directory"\."position", length\("symbol_directory"\."symbol"\), "symbol_directory"\."symbol" limit \$\d+/);
        assert.ok(params.includes("BRK.B%"));
        assert.ok(params.includes("%brk b%"));
    });

    test("a query that can't be a ticker matches names only", () => {
        const { sql, params } = buildDirectorySearchQuery(query("bank of america"), 8, database).toSQL();
        assert.doesNotMatch(sql, /then 0/);
        assert.ok(params.includes("%bank of america%"));
    });

    test("LIKE wildcards in the query match only themselves", () => {
        const { params } = buildDirectorySearchQuery(query("50%_off\\"), 8, database).toSQL();
        assert.ok(params.includes("%50\\%\\_off\\\\%"));
    });

    test("holdings are the user's own; the price store gives only the benchmark ETFs", () => {
        const held = buildHeldSymbolsQuery("user-a", database).toSQL();
        assert.match(held.sql, /select distinct [\s\S]* inner join "portfolios" on "portfolios"\."id" = "holdings"\."portfolio_id" left join "symbol_directory" on "symbol_directory"\."symbol" = upper\("holdings"\."symbol"\) where "portfolios"\."user_id" = \$1/);
        assert.deepEqual(held.params, ["user-a"]);
        const benchmarks = buildBenchmarkSymbolsQuery(database).toSQL();
        assert.match(benchmarks.sql, /"securities"\."symbol" in \(/);
        assert.ok(benchmarks.params.includes("SPY") && benchmarks.params.includes("XLK"));
    });

    test("a refresh rewrites only the rows that differ", () => {
        const { sql } = buildUpsertDirectoryQuery(
            [{ symbol: "AAPL", name: "Apple Inc.", exchange: "Nasdaq", cik: "0000320193", position: 0 }],
            new Date("2026-11-03T22:31:00Z"),
            database,
        ).toSQL();
        assert.match(sql, /on conflict \("symbol"\) do update set [\s\S]* where \("symbol_directory"\."name", "symbol_directory"\."exchange", "symbol_directory"\."cik", "symbol_directory"\."position"\)\s+is distinct from \(excluded\.name, excluded\.exchange, excluded\.cik, excluded\.position\)$/);
    });
});

describe("refreshSymbolDirectory", () => {
    // Fails the test if the refresh writes anything.
    const untouched = { transaction: () => assert.fail("the directory must not be written") } as never;

    test("a file too short to be whole keeps the directory", async () => {
        const detail = await refreshSymbolDirectory({ fetchTickers: async () => [sec("AAPL", "Apple Inc.")], database: untouched });
        assert.deepEqual(detail, { error: `SEC's ticker file had 1 usable tickers; the directory was kept.` });
        assert.ok(MIN_DIRECTORY_SIZE >= 5_000);
    });

    test("a failed fetch keeps the directory and says why, without throwing", async () => {
        const detail = await refreshSymbolDirectory({
            fetchTickers: async () => { throw new Error("SEC EDGAR request failed"); },
            database: untouched,
        });
        assert.deepEqual(detail, { error: "SEC EDGAR request failed" });
    });
});
