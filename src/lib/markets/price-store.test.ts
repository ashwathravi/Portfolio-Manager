import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    buildBarsQuery,
    buildDeleteBarsQuery,
    buildDeleteHistoryQuery,
    buildHasBarsQuery,
    buildLatestBarDateQuery,
    buildLatestClosesQuery,
    buildMarkHistoryAttemptedQuery,
    buildMarkHistoryLoadedQuery,
    buildPruneUnpricedSecuritiesQuery,
    buildResetUnpricedHistoryQuery,
    buildRecentClosesQuery,
    buildRequeueHistoryQuery,
    buildResetHistoryQuery,
    buildSymbolsNeedingHistoryCountQuery,
    buildStoredDatesQuery,
    buildSymbolsNeedingHistoryQuery,
    buildTrackedAmongQuery,
    buildTrackedCountQuery,
    buildTrackSecuritiesQuery,
    REQUESTED_TRACKING_LOCK,
    buildUpsertBarsQuery,
    dedupeBars,
    isValidBar,
    normalizeSymbols,
    replaceHistory,
    selectTrackedBars,
    trackRequestedSecurities,
    type PriceBarInput,
    buildSaveReferenceQuery,
    buildSecurityProfilesQuery,
    buildSymbolsNeedingReferenceQuery,
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

    test("the backfill queue takes active symbols without history that a daily file priced, oldest first", () => {
        const { sql, params } = buildSymbolsNeedingHistoryQuery(5).toSQL();
        assert.match(sql, /"securities"\."history_start_date" is null/i);
        assert.match(sql, /"securities"\."active" = \$\d+/i);
        assert.match(sql, /and exists \(select 1 from "price_bars" where "price_bars"\."symbol" = "securities"\."symbol"\)/i);
        // Never tried first; no positional "order by 0" (Postgres rejects it) without priority symbols.
        assert.match(sql, /order by "securities"\."history_attempted_at" asc nulls first, "securities"\."created_at" asc, "securities"\."symbol" asc limit \$\d+$/i);
        assert.deepEqual(params, [true, 5]);
    });

    test("the backfill queue takes priority symbols at once, and first", () => {
        const { sql, params } = buildSymbolsNeedingHistoryQuery(5, ["AAPL", "SPY"]).toSQL();
        assert.match(sql, /\("securities"\."symbol" in \(\$\d+, \$\d+\) or exists \(select 1 from "price_bars"/i);
        // Priority first; within each group, never tried first, then the least recently tried.
        assert.match(sql, /order by case when "securities"\."symbol" in \(\$\d+, \$\d+\) then 0 else 1 end, "securities"\."history_attempted_at" asc nulls first, "securities"\."created_at" asc/i);
        assert.deepEqual(params, [true, "AAPL", "SPY", "AAPL", "SPY", 5]);
    });

    test("the backfill queue count uses the same filter as the queue", () => {
        const { sql, params } = buildSymbolsNeedingHistoryCountQuery(["AAPL"]).toSQL();
        assert.match(sql, /^select count\(\*\) from "securities" where/i);
        assert.match(sql, /"securities"\."history_start_date" is null and "securities"\."active" = \$\d+ and \("securities"\."symbol" in \(\$\d+\) or exists/i);
        assert.deepEqual(params, [true, "AAPL"]);
    });

    test("re-queuing unpriced histories touches only loaded symbols with no bar at all", () => {
        const { sql, params } = buildResetUnpricedHistoryQuery(["NEWCO"]).toSQL();
        assert.match(sql, /^update "securities" set "history_start_date" = \$\d+, "history_attempted_at" = \$\d+, "updated_at" = \$\d+ where/);
        assert.match(sql, /"securities"\."symbol" in \(\$\d+\) and "securities"\."history_start_date" is not null and not exists \(select 1 from "price_bars" where "price_bars"\."symbol" = "securities"\."symbol"\)\) returning "symbol"$/);
        assert.deepEqual(params.slice(0, 2), [null, null]);
        assert.equal(params[3], "NEWCO");
    });

    test("a replace reads every stored date from the history's first day through the cut-off", () => {
        const { sql, params } = buildStoredDatesQuery("NVDA", "2024-10-17", "2026-10-16").toSQL();
        assert.equal(sql, 'select "date" from "price_bars" where ("price_bars"."symbol" = $1 and "price_bars"."date" >= $2 and "price_bars"."date" <= $3)');
        assert.deepEqual(params, ["NVDA", "2024-10-17", "2026-10-16"]);
    });

    test("clearing a split deletes all of a stock's bars and re-queues it, loaded or not", () => {
        const remove = buildDeleteBarsQuery(["NVDA"]).toSQL();
        assert.equal(remove.sql, 'delete from "price_bars" where "price_bars"."symbol" in ($1)');
        assert.deepEqual(remove.params, ["NVDA"]);
        const requeue = buildRequeueHistoryQuery(["NVDA"]).toSQL();
        assert.match(requeue.sql, /^update "securities" set "history_start_date" = \$1, "history_attempted_at" = \$2, "updated_at" = \$3 where "securities"\."symbol" in \(\$4\) returning "symbol"$/);
        assert.deepEqual(requeue.params.slice(0, 2), [null, null]);
    });

    test("an attempt is recorded, and loading or resetting clears it", () => {
        const at = new Date("2026-10-16T22:31:00Z");
        const attempt = buildMarkHistoryAttemptedQuery("NVDA", at).toSQL();
        assert.equal(attempt.sql, 'update "securities" set "history_attempted_at" = $1, "updated_at" = $2 where "securities"."symbol" = $3');
        assert.deepEqual(attempt.params, [at.toISOString(), at.toISOString(), "NVDA"]);
        for (const { sql } of [buildMarkHistoryLoadedQuery("NVDA", "2024-10-17").toSQL(), buildResetHistoryQuery(["NVDA"]).toSQL(), buildResetUnpricedHistoryQuery(["NVDA"]).toSQL()]) {
            assert.match(sql, /"history_attempted_at" = \$\d+/);
        }
    });

    test("checking for stored bars reads at most one row", () => {
        const { sql, params } = buildHasBarsQuery("NVDA").toSQL();
        assert.equal(sql, 'select "symbol" from "price_bars" where "price_bars"."symbol" = $1 limit $2');
        assert.deepEqual(params, ["NVDA", 1]);
    });

    test("pruning drops only old, never-priced securities outside the keep list", () => {
        const before = new Date("2026-10-09T22:30:00Z");
        const { sql, params } = buildPruneUnpricedSecuritiesQuery(["AAPL"], before).toSQL();
        assert.equal(sql, 'delete from "securities" where ("securities"."created_at" < $1 and "securities"."history_start_date" is null and "securities"."symbol" not in ($2) and not exists (select 1 from "price_bars" where "price_bars"."symbol" = "securities"."symbol")) returning "symbol"');
        assert.deepEqual(params, ["2026-10-09T22:30:00.000Z", "AAPL"]);
        assert.doesNotMatch(buildPruneUnpricedSecuritiesQuery([], before).toSQL().sql, /not in/);
    });

    test("the latest stored date is the maximum bar date across all symbols", () => {
        const { sql, params } = buildLatestBarDateQuery().toSQL();
        assert.equal(sql, 'select max("date") from "price_bars"');
        assert.deepEqual(params, []);
    });

    test("a history reset re-queues only symbols whose history was loaded", () => {
        const { sql, params } = buildResetHistoryQuery(["NVDA", "AAPL"]).toSQL();
        assert.match(sql, /^update "securities" set "history_start_date" = \$\d+, "history_attempted_at" = \$\d+, "updated_at" = \$\d+/i);
        assert.match(sql, /"securities"\."symbol" in \(\$\d+, \$\d+\) and "securities"\."history_start_date" is not null/i);
        assert.match(sql, /returning "symbol"$/i);
        assert.deepEqual(params.slice(0, 2), [null, null], "a reset is a fresh start for retries too");
        assert.deepEqual(params.slice(3), ["NVDA", "AAPL"]);
    });

    test("marking history loaded records where it starts", () => {
        const { sql, params } = buildMarkHistoryLoadedQuery("NVDA", "2024-10-17").toSQL();
        assert.match(sql, /^update "securities" set "history_start_date" = \$\d+, "history_attempted_at" = \$\d+, "updated_at" = \$\d+ where "securities"\."symbol" = \$\d+$/i);
        assert.deepEqual(params.slice(0, 2), ["2024-10-17", null]);
        assert.equal(params[3], "NVDA");
    });

    test("a history replace deletes one symbol's bars up to the day given, never later ones", () => {
        const { sql, params } = buildDeleteHistoryQuery("NVDA", "2026-10-16").toSQL();
        assert.equal(sql, 'delete from "price_bars" where ("price_bars"."symbol" = $1 and "price_bars"."date" <= $2)');
        assert.deepEqual(params, ["NVDA", "2026-10-16"]);
    });
});

describe("replaceHistory", () => {
    const untouchable = new Proxy({}, { get: () => () => assert.fail("the database was used") }) as never;

    test("with no valid bar, changes nothing and says so", async () => {
        const inconsistent = { ...BAR, symbol: "NVDA", high: 1 };
        assert.equal(await replaceHistory("NVDA", [], "2026-10-16", untouchable), undefined);
        assert.equal(await replaceHistory("NVDA", [inconsistent], "2026-10-16", untouchable), undefined);
        // Another symbol's bars, and bars after the cut-off, are never this history.
        assert.equal(await replaceHistory("NVDA", [BAR, { ...BAR, symbol: "NVDA", date: "2026-10-19" }], "2026-10-16", untouchable), undefined);
    });
});

describe("trackRequestedSecurities", () => {
    /** Just enough of the database for a locked transaction: tracked lookup, count, insert. */
    function fakeDatabase(tracked: number, existing: string[] = []) {
        const inserted: string[][] = [];
        const steps: string[] = [];
        const tx = {
            execute: async (query: unknown) => {
                steps.push(query === REQUESTED_TRACKING_LOCK ? "lock" : "other");
            },
            select: () => ({
                // Awaited as is: the count. With .where(): the tracked lookup.
                from: () => ({
                    then: (resolve: (rows: unknown) => void) => {
                        steps.push("count");
                        resolve([{ count: tracked }]);
                    },
                    where: async () => {
                        steps.push("existing");
                        return existing.map((symbol) => ({ symbol }));
                    },
                }),
            }),
            insert: () => ({
                values: (rows: Array<{ symbol: string }>) => ({
                    onConflictDoNothing: () => ({
                        returning: async () => {
                            steps.push("insert");
                            inserted.push(rows.map((row) => row.symbol));
                            return rows.map(({ symbol }) => ({ symbol }));
                        },
                    }),
                }),
            }),
        };
        const database = {
            transaction: async <T>(run: (transaction: typeof tx) => Promise<T>) => {
                steps.push("begin");
                const result = await run(tx);
                steps.push("commit");
                return result;
            },
        };
        return { database: database as never, inserted, steps };
    }

    test("counts and inserts in one transaction, after taking the reservation lock", async () => {
        const { database, steps } = fakeDatabase(10);
        await trackRequestedSecurities(["AAPL"], 100, database);
        assert.deepEqual(steps, ["begin", "lock", "existing", "count", "insert", "commit"]);
        assert.match(REQUESTED_TRACKING_LOCK.toQuery({ escapeName: (n: string) => n, escapeParam: () => "?", escapeString: (v: string) => `'${v}'` } as never).sql, /^select pg_advisory_xact_lock\(hashtext\('atlas:requested-tracking'\)\)$/);
    });

    test("tracks requested symbols while the store is under its limit", async () => {
        const { database, inserted } = fakeDatabase(10);
        assert.deepEqual(await trackRequestedSecurities(["aapl", "MSFT"], 100, database), { added: ["AAPL", "MSFT"], refused: [] });
        assert.deepEqual(inserted, [["AAPL", "MSFT"]]);
    });

    test("tracks only as many as fit, and none at the limit", async () => {
        const nearly = fakeDatabase(98);
        assert.deepEqual(await trackRequestedSecurities(["A", "B", "C"], 100, nearly.database), { added: ["A", "B"], refused: ["C"] });

        const full = fakeDatabase(100);
        assert.deepEqual(await trackRequestedSecurities(["A"], 100, full.database), { added: [], refused: ["A"] });
        assert.deepEqual(full.inserted, []);

        const over = fakeDatabase(150);
        assert.deepEqual(await trackRequestedSecurities(["A"], 100, over.database), { added: [], refused: ["A"] });
    });

    test("regression: symbols tracked already take no room", async () => {
        // One slot left; BTC-USD is tracked (but unpriced), NEW is not.
        const { database, inserted } = fakeDatabase(1_999, ["BTC-USD"]);
        assert.deepEqual(await trackRequestedSecurities(["BTC-USD", "NEW"], 2_000, database), { added: ["NEW"], refused: [] });
        assert.deepEqual(inserted, [["NEW"]]);

        const allTracked = fakeDatabase(2_000, ["BTC-USD"]);
        assert.deepEqual(await trackRequestedSecurities(["BTC-USD"], 2_000, allTracked.database), { added: [], refused: [] });
        assert.deepEqual(allTracked.steps, ["begin", "lock", "existing", "commit"]);
    });

    test("never counts or writes for nothing trackable", async () => {
        const untouchable = new Proxy({}, { get: () => () => assert.fail("the database was used") }) as never;
        assert.deepEqual(await trackRequestedSecurities(["", "AAPL260116C00250000"], 100, untouchable), { added: [], refused: [] });
    });

    test("the limit counts every tracked security", () => {
        assert.equal(buildTrackedCountQuery().toSQL().sql, 'select count(*) from "securities"');
    });

    test("finds which requested symbols are tracked already", () => {
        const { sql, params } = buildTrackedAmongQuery(["BTC-USD", "NEW"]).toSQL();
        assert.equal(sql, 'select "symbol" from "securities" where "securities"."symbol" in ($1, $2)');
        assert.deepEqual(params, ["BTC-USD", "NEW"]);
    });
});

describe("securities master queries", () => {
    const AT = new Date("2026-10-16T22:30:00.000Z");
    const STALE_BEFORE = new Date("2026-07-18T22:30:00.000Z");

    test("the reference queue: missing or stale, priority first, never fetched before the oldest", () => {
        const { sql, params } = buildSymbolsNeedingReferenceQuery(5, ["MSFT"], STALE_BEFORE).toSQL();
        assert.match(sql, /where \("securities"\."reference_updated_at" is null or "securities"\."reference_updated_at" < \$1\)/);
        assert.match(sql, /order by case when "securities"\."symbol" in \(\$2\) then 0 else 1 end, "securities"\."reference_updated_at" asc nulls first/);
        assert.deepEqual(params.slice(1), ["MSFT", 5]);
    });

    test("saving stores the profile and when it was fetched", () => {
        const { sql, params } = buildSaveReferenceQuery("AAPL", {
            symbol: "AAPL", name: "Apple Inc.", type: "CS", primaryExchange: "XNAS", active: true,
            currency: "usd", sicCode: "3571", sicDescription: "ELECTRONIC COMPUTERS",
        }, AT).toSQL();
        assert.match(sql, /^update "securities" set "name" = \$1, "type" = \$2, "primary_exchange" = \$3, "currency" = \$4, "sector" = \$5, "industry" = \$6, "sic_code" = \$7, "reference_updated_at" = \$8, "updated_at" = \$9 where "securities"\."symbol" = \$10$/);
        assert.deepEqual(params.slice(0, 6), ["Apple Inc.", "CS", "XNAS", "USD", "Tech", "ELECTRONIC COMPUTERS"]);
        assert.equal(params.at(-1), "AAPL");
    });

    test("an unknown ticker only records that it was looked for", () => {
        const { sql, params } = buildSaveReferenceQuery("ZZZZ", null, AT).toSQL();
        assert.equal(sql, 'update "securities" set "reference_updated_at" = $1, "updated_at" = $2 where "securities"."symbol" = $3');
        assert.equal(params[2], "ZZZZ");
    });

    test("profiles are read only for symbols with reference data", () => {
        const { sql, params } = buildSecurityProfilesQuery(["AAPL", "MSFT"]).toSQL();
        assert.match(sql, /where \("securities"\."symbol" in \(\$1, \$2\) and "securities"\."reference_updated_at" is not null\)/);
        assert.deepEqual(params, ["AAPL", "MSFT"]);
    });
});
