import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    buildBarsQuery,
    buildLatestClosesQuery,
    buildRecentClosesQuery,
    buildSymbolsNeedingHistoryQuery,
    buildTrackedCountQuery,
    buildTrackSecuritiesQuery,
    buildUpsertBarsQuery,
    dedupeBars,
    isValidBar,
    normalizeSymbols,
    selectTrackedBars,
    trackRequestedSecurities,
    type PriceBarInput,
} from "./price-store";

const BAR: PriceBarInput = {
    symbol: "AAPL",
    date: "2026-10-09",
    open: 250,
    high: 255,
    low: 248,
    close: 254,
    volume: 51_000_000,
    source: "massive",
};

describe("normalizeSymbols", () => {
    test("uppercases, trims and dedupes while keeping order", () => {
        assert.deepEqual(normalizeSymbols([" aapl", "MSFT", "AAPL", "brk.b"]), ["AAPL", "MSFT", "BRK.B"]);
    });

    test("drops option contracts, blanks and other non-tickers", () => {
        assert.deepEqual(normalizeSymbols(["", "AAPL260116C00250000", "CASH & SWEEP", "SPY"]), ["SPY"]);
    });
});

describe("isValidBar", () => {
    test("accepts a consistent bar", () => {
        assert.equal(isValidBar(BAR), true);
    });

    test("accepts a zero-volume bar", () => {
        assert.equal(isValidBar({ ...BAR, volume: 0 }), true);
    });

    for (const [name, bar] of [
        ["a high below the close", { ...BAR, high: 253 }],
        ["a low above the open", { ...BAR, low: 251 }],
        ["a zero price", { ...BAR, low: 0 }],
        ["a NaN close", { ...BAR, close: Number.NaN }],
        ["negative volume", { ...BAR, volume: -1 }],
        ["a timestamp instead of a date", { ...BAR, date: "2026-10-09T00:00:00Z" }],
        ["February 30", { ...BAR, date: "2026-02-30" }],
        ["a thirteenth month", { ...BAR, date: "2026-13-01" }],
        ["a lowercase symbol", { ...BAR, symbol: "aapl" }],
        ["no source", { ...BAR, source: " " }],
    ] as const) {
        test(`rejects ${name}`, () => {
            assert.equal(isValidBar(bar), false);
        });
    }
});

describe("dedupeBars", () => {
    test("keeps one bar per symbol and date, the last one given", () => {
        const bars = [BAR, { ...BAR, symbol: "MSFT" }, { ...BAR, close: 253 }, { ...BAR, date: "2026-10-08" }];
        assert.deepEqual(
            dedupeBars(bars).map((bar) => [bar.symbol, bar.date, bar.close]),
            [["AAPL", "2026-10-09", 253], ["MSFT", "2026-10-09", 254], ["AAPL", "2026-10-08", 254]],
        );
    });
});

describe("selectTrackedBars", () => {
    test("keeps only bars for tracked symbols", () => {
        const bars = [BAR, { ...BAR, symbol: "ZZZZ" }, { ...BAR, symbol: "MSFT" }];
        assert.deepEqual(
            selectTrackedBars(bars, new Set(["AAPL", "MSFT"])).map((bar) => bar.symbol),
            ["AAPL", "MSFT"],
        );
    });
});

describe("price store queries", () => {
    test("tracking a symbol twice is a no-op that reports only new symbols", () => {
        const { sql } = buildTrackSecuritiesQuery(["AAPL"]).toSQL();
        assert.match(sql, /insert into "securities"/i);
        assert.match(sql, /on conflict \("symbol"\) do nothing/i);
        assert.match(sql, /returning "symbol"/i);
    });

    test("bars upsert on (symbol, date) and take the new values", () => {
        const { sql, params } = buildUpsertBarsQuery([BAR]).toSQL();
        assert.match(sql, /insert into "price_bars"/i);
        assert.match(sql, /on conflict \("symbol","date"\) do update set/i);
        for (const column of ["open", "high", "low", "close", "volume", "source", "updated_at"]) {
            assert.match(sql, new RegExp(`"${column}" = excluded\\.${column}`));
        }
        assert.ok(params.includes("AAPL"));
        assert.ok(params.includes("2026-10-09"));
    });

    test("latest closes take one row per symbol, newest first", () => {
        const { sql, params } = buildLatestClosesQuery(["AAPL", "MSFT"]).toSQL();
        assert.match(sql, /select distinct on \("price_bars"\."symbol"\)/i);
        assert.match(sql, /order by "price_bars"\."symbol", "price_bars"\."date" desc/i);
        assert.doesNotMatch(sql, /"date" <=/);
        assert.deepEqual(params, ["AAPL", "MSFT"]);
    });

    test("latest closes can be taken as of a date", () => {
        const { sql, params } = buildLatestClosesQuery(["AAPL"], "2026-09-30").toSQL();
        assert.match(sql, /"price_bars"\."date" <= \$\d+/);
        assert.deepEqual(params, ["AAPL", "2026-09-30"]);
    });

    test("recent closes rank each symbol's bars newest first and keep the top few", () => {
        const { sql, params } = buildRecentClosesQuery(["AAPL", "MSFT"], 2).toSQL();
        assert.match(sql, /row_number\(\) over \(partition by "symbol" order by "date" desc\) as "rank"/i);
        assert.match(sql, /"rank" <= \$\d+/);
        assert.match(sql, /order by "ranked"\."symbol" asc, "ranked"\."date" desc/i);
        assert.deepEqual(params, ["AAPL", "MSFT", 2]);
    });

    test("bar ranges are inclusive and in date order", () => {
        const { sql, params } = buildBarsQuery("AAPL", "2026-01-01", "2026-06-30").toSQL();
        assert.match(sql, /"price_bars"\."date" >= \$\d+ and "price_bars"\."date" <= \$\d+/i);
        assert.match(sql, /order by "price_bars"\."date" asc/i);
        assert.deepEqual(params, ["AAPL", "2026-01-01", "2026-06-30"]);
    });

    test("the backfill queue takes active symbols without history, oldest first", () => {
        const { sql, params } = buildSymbolsNeedingHistoryQuery(5).toSQL();
        assert.match(sql, /"securities"\."history_start_date" is null/i);
        assert.match(sql, /"securities"\."active" = \$\d+/i);
        assert.match(sql, /order by "securities"\."created_at" asc, "securities"\."symbol" asc limit \$\d+/i);
        assert.deepEqual(params, [true, 5]);
    });
});

describe("trackRequestedSecurities", () => {
    /** Just enough of the database for a count, then an insert of the symbols. */
    function fakeDatabase(tracked: number) {
        const inserted: string[][] = [];
        const database = {
            select: () => ({ from: async () => [{ count: tracked }] }),
            insert: () => ({
                values: (rows: Array<{ symbol: string }>) => ({
                    onConflictDoNothing: () => ({
                        returning: async () => {
                            inserted.push(rows.map((row) => row.symbol));
                            return rows.map(({ symbol }) => ({ symbol }));
                        },
                    }),
                }),
            }),
        };
        return { database: database as never, inserted };
    }

    test("tracks requested symbols while the store is under its limit", async () => {
        const { database, inserted } = fakeDatabase(10);
        assert.deepEqual(await trackRequestedSecurities(["aapl", "MSFT"], 100, database), ["AAPL", "MSFT"]);
        assert.deepEqual(inserted, [["AAPL", "MSFT"]]);
    });

    test("tracks only as many as fit, and none at the limit", async () => {
        const nearly = fakeDatabase(98);
        assert.deepEqual(await trackRequestedSecurities(["A", "B", "C"], 100, nearly.database), ["A", "B"]);

        const full = fakeDatabase(100);
        assert.deepEqual(await trackRequestedSecurities(["A"], 100, full.database), []);
        assert.deepEqual(full.inserted, []);

        const over = fakeDatabase(150);
        assert.deepEqual(await trackRequestedSecurities(["A"], 100, over.database), []);
    });

    test("never counts or writes for nothing trackable", async () => {
        const untouchable = new Proxy({}, { get: () => () => assert.fail("the database was used") }) as never;
        assert.deepEqual(await trackRequestedSecurities(["", "AAPL260116C00250000"], 100, untouchable), []);
    });

    test("the limit counts every tracked security", () => {
        assert.equal(buildTrackedCountQuery().toSQL().sql, 'select count(*) from "securities"');
    });
});
