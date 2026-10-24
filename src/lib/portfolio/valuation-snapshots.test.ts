import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    buildClosesBetweenQuery,
    awaitsSplit,
    buildCompleteDaysQuery,
    buildLatestHoldingSplitsQuery,
    buildPortfolioStatesQuery,
    buildPositionsQuery,
    buildUpsertSnapshotsQuery,
    buildUserSnapshotsQuery,
    createSnapshotStore,
    MAX_SNAPSHOT_DAYS,
    recordValuationSnapshots,
    sessionClosedAt,
    snapshotDays,
    splitReadiness,
    valueSnapshot,
    windowStart,
    type PositionInput,
    type SnapshotStore,
    type SnapshotValue,
    type StoredClose,
} from "./valuation-snapshots";

// Thursday 15 and Friday 16 October 2026 close at 4:00 PM EDT (20:00Z).
const THU = "2026-10-15";
const FRI = "2026-10-16";

function closes(entries: Record<string, Array<[string, number]>>): Map<string, StoredClose[]> {
    return new Map(Object.entries(entries).map(([symbol, bars]) => [symbol, bars.map(([date, close]) => ({ date, close }))]));
}

describe("sessionClosedAt and windowStart", () => {
    test("a session closes at 4:00 PM ET, or 1:00 PM on an early-close day", () => {
        assert.equal(sessionClosedAt(FRI).toISOString(), "2026-10-16T20:00:00.000Z");
        assert.equal(sessionClosedAt("2026-11-27").toISOString(), "2026-11-27T18:00:00.000Z");
    });

    test("a window of n sessions starts n - 1 trading days back", () => {
        assert.equal(windowStart(FRI, 1), FRI);
        assert.equal(windowStart(FRI, 2), THU);
        assert.equal(windowStart("2026-10-19", 2), FRI, "skips the weekend");
    });
});

describe("snapshotDays", () => {
    const none = new Set<string>();

    test("an unchanged portfolio is filled back over the whole window, oldest first", () => {
        const days = snapshotDays({ latest: FRI, lastChange: new Date("2026-01-01T00:00:00Z"), complete: none, max: 4 });
        assert.deepEqual(days, ["2026-10-13", "2026-10-14", THU, FRI]);
    });

    test("stops at the last change: no snapshot for a close the portfolio has changed since", () => {
        // Imported at 11:00 AM ET on Thursday: Thursday's close already had it.
        assert.deepEqual(snapshotDays({ latest: FRI, lastChange: new Date("2026-10-15T15:00:00Z"), complete: none }), [THU, FRI]);
        // Imported at 6:00 PM ET on Thursday, after the close.
        assert.deepEqual(snapshotDays({ latest: FRI, lastChange: new Date("2026-10-15T22:00:00Z"), complete: none }), [FRI]);
        // Changed after the latest close: nothing to record yet.
        assert.deepEqual(snapshotDays({ latest: FRI, lastChange: new Date("2026-10-16T21:00:00Z"), complete: none }), []);
    });

    test("an early close counts as the close", () => {
        // Imported at 2:00 PM ET on the day after Thanksgiving, after its 1:00 PM close.
        assert.deepEqual(snapshotDays({ latest: "2026-11-30", lastChange: new Date("2026-11-27T19:00:00Z"), complete: none }), ["2026-11-30"]);
    });

    test("skips days that already have a complete snapshot, still within the window", () => {
        const days = snapshotDays({ latest: FRI, lastChange: new Date("2026-01-01T00:00:00Z"), complete: new Set([THU, "2026-10-13"]), max: 4 });
        assert.deepEqual(days, ["2026-10-14", FRI]);
    });

    test("the default window is a year of sessions", () => {
        assert.equal(MAX_SNAPSHOT_DAYS, 260);
        assert.equal(snapshotDays({ latest: FRI, lastChange: new Date("2018-06-01T00:00:00Z"), complete: none }).length, 260);
    });
});

describe("valueSnapshot", () => {
    test("values each symbol at its close, combines holdings of one symbol, and adds cash", () => {
        const positions: PositionInput[] = [
            { symbol: "aapl", quantity: 10, avgCost: 150 },
            { symbol: "AAPL", quantity: 5, avgCost: 180 }, // a second account row
            { symbol: "MSFT", quantity: 2, avgCost: 300 },
            { symbol: "GONE", quantity: 0, avgCost: 10 }, // sold
        ];
        const snapshot = valueSnapshot(FRI, positions, closes({ AAPL: [[THU, 190], [FRI, 200]], MSFT: [[FRI, 400]] }), 1_000);

        assert.deepEqual(snapshot, {
            date: FRI,
            holdingsValue: 15 * 200 + 2 * 400,
            cash: 1_000,
            totalValue: 15 * 200 + 2 * 400 + 1_000,
            costBasis: 10 * 150 + 5 * 180 + 2 * 300,
            positions: [
                { symbol: "AAPL", quantity: 15, costBasis: 2_400, close: 200, closeDate: FRI, marketValue: 3_000 },
                { symbol: "MSFT", quantity: 2, costBasis: 600, close: 400, closeDate: FRI, marketValue: 800 },
            ],
            unpriced: [],
        });
    });

    test("uses the last close on or before the day, never a later one", () => {
        const snapshot = valueSnapshot(THU, [{ symbol: "AAPL", quantity: 1, avgCost: 1 }], closes({ AAPL: [["2026-10-14", 188], [FRI, 200]] }), 0);
        assert.deepEqual([snapshot.positions[0].close, snapshot.positions[0].closeDate], [188, "2026-10-14"]);
    });

    test("a symbol without a recent close is unpriced: no value, but its cost still counts", () => {
        const snapshot = valueSnapshot(
            FRI,
            [{ symbol: "AAPL", quantity: 1, avgCost: 100 }, { symbol: "STALE", quantity: 2, avgCost: 10 }, { symbol: "NEW", quantity: 3, avgCost: 5 }],
            closes({ AAPL: [[FRI, 200]], STALE: [["2026-10-08", 9]] }), // eight days old
            0,
        );
        assert.deepEqual(snapshot.unpriced, ["NEW", "STALE"]);
        assert.equal(snapshot.holdingsValue, 200);
        assert.equal(snapshot.costBasis, 100 + 20 + 15);
        assert.deepEqual(snapshot.positions.find((position) => position.symbol === "STALE"), {
            symbol: "STALE", quantity: 2, costBasis: 20, close: null, closeDate: null, marketValue: null,
        });
    });

    test("a cash-only portfolio is its cash", () => {
        assert.deepEqual(valueSnapshot(FRI, [], new Map(), 2_500), {
            date: FRI, holdingsValue: 0, cash: 2_500, totalValue: 2_500, costBasis: 0, positions: [], unpriced: [],
        });
        assert.equal(valueSnapshot(FRI, [], new Map(), Number.NaN).totalValue, 0);
    });
});

describe("snapshot queries", () => {
    test("portfolio states read every portfolio with its latest change across its holdings", () => {
        const { sql } = buildPortfolioStatesQuery().toSQL();
        assert.match(sql, /greatest\("portfolios"\."created_at", "portfolios"\."updated_at", max\("holdings"\."created_at"\), max\("holdings"\."updated_at"\)\)/);
        assert.match(sql, /from "portfolios" left join "holdings" on "holdings"\."portfolio_id" = "portfolios"\."id" group by "portfolios"\."id"$/);
        assert.doesNotMatch(sql, /user_id" = /, "the nightly job values every portfolio");
    });

    test("closes are read for the symbols over the range, in date order", () => {
        const { sql, params } = buildClosesBetweenQuery(["AAPL", "MSFT"], "2026-10-08", FRI).toSQL();
        assert.match(sql, /"price_bars"\."symbol" in \(\$1, \$2\) and "price_bars"\."date" >= \$3 and "price_bars"\."date" <= \$4/);
        assert.match(sql, /order by "price_bars"\."symbol" asc, "price_bars"\."date" asc$/);
        assert.deepEqual(params, ["AAPL", "MSFT", "2026-10-08", FRI]);
    });

    test("only snapshots priced at each day's own closes count as complete", () => {
        const { sql } = buildCompleteDaysQuery(["p1"], THU).toSQL();
        assert.match(sql, /cardinality\("portfolio_snapshots"\."unpriced"\) = 0/);
        assert.match(sql, /not exists \(select 1 from "portfolio_snapshot_positions" where "portfolio_snapshot_positions"\."portfolio_id" = "portfolio_snapshots"\."portfolio_id" and "portfolio_snapshot_positions"\."date" = "portfolio_snapshots"\."date" and "portfolio_snapshot_positions"\."close_date" is distinct from "portfolio_snapshots"\."date"\)/);
    });

    test("split readiness comes from the newest successful price run that checked held positions", () => {
        const { sql, params } = buildLatestHoldingSplitsQuery().toSQL();
        assert.match(sql, /^select "detail" -> 'holdingSplits' from "job_runs" where \("job_runs"\."job" = \$1 and "job_runs"\."status" = \$2 and "job_runs"\."detail" \? 'holdingSplits'\) order by "job_runs"\."started_at" desc limit \$3$/);
        assert.deepEqual(params, ["prices", "succeeded", 1]);
    });

    test("positions are read for every portfolio, with when each changed", () => {
        const { sql } = buildPositionsQuery().toSQL();
        assert.equal(sql, 'select "portfolio_id", "symbol", "quantity", "avg_cost", "updated_at" from "holdings"');
    });

    test("snapshots upsert on (portfolio, date)", () => {
        const snapshot: SnapshotValue = { date: FRI, holdingsValue: 1, cash: 2, totalValue: 3, costBasis: 4, positions: [], unpriced: ["X"] };
        const { sql } = buildUpsertSnapshotsQuery("p1", [snapshot]).toSQL();
        assert.match(sql, /^insert into "portfolio_snapshots"/);
        assert.match(sql, /on conflict \("portfolio_id","date"\) do update set "holdings_value" = excluded\.holdings_value/);
        assert.match(sql, /"unpriced" = excluded\.unpriced/);
    });

    test("a user only ever reads snapshots of their own portfolios", () => {
        const all = buildUserSnapshotsQuery("user-a").toSQL();
        assert.match(all.sql, /inner join "portfolios" on "portfolio_snapshots"\."portfolio_id" = "portfolios"\."id" where "portfolios"\."user_id" = \$1 order by/);
        assert.deepEqual(all.params, ["user-a"]);

        const narrowed = buildUserSnapshotsQuery("user-a", { portfolioId: "p1", from: THU, to: FRI }).toSQL();
        assert.match(narrowed.sql, /"portfolios"\."user_id" = \$1 and "portfolio_snapshots"\."portfolio_id" = \$2 and "portfolio_snapshots"\."date" >= \$3 and "portfolio_snapshots"\."date" <= \$4/);
        assert.deepEqual(narrowed.params, ["user-a", "p1", THU, FRI]);
    });
});

describe("recordValuationSnapshots", () => {
    function fakeStore({
        latest = FRI as string | null,
        states = [] as Array<{ portfolioId: string; cash: number; lastChange: string }>,
        positions = {} as Record<string, PositionInput[]>,
        bars = {} as Record<string, Array<[string, number]>>,
        complete = {} as Record<string, string[]>,
        holdingSplits = { from: "2026-09-01", to: FRI } as unknown,
    } = {}) {
        const writes: Array<{ portfolioId: string; snapshots: readonly SnapshotValue[] }> = [];
        const closeQueries: Array<[string[], string, string]> = [];
        const store: SnapshotStore = {
            latestCloseDate: async () => latest,
            latestHoldingSplits: async () => holdingSplits,
            portfolios: async () => states.map((state) => ({
                ...state,
                lastChange: new Date(state.lastChange),
                positions: positions[state.portfolioId] ?? [],
            })),
            closes: async (symbols, from, to) => {
                closeQueries.push([symbols, from, to]);
                return closes(Object.fromEntries(symbols.filter((symbol) => bars[symbol]).map((symbol) => [symbol, bars[symbol]])));
            },
            completeDays: async (ids) => new Map(ids.map((id) => [id, new Set(complete[id] ?? [])])),
            write: async (portfolioId, snapshots) => {
                writes.push({ portfolioId, snapshots });
            },
        };
        return { store, writes, closeQueries };
    }

    test("does nothing before any close is stored", async () => {
        const { store, writes } = fakeStore({ latest: null, states: [{ portfolioId: "p1", cash: 0, lastChange: "2026-10-01T00:00:00Z" }] });
        assert.deepEqual(await recordValuationSnapshots({ store }), { skipped: "no closes stored yet" });
        assert.deepEqual(writes, []);
    });

    test("records each portfolio's missing days back to its last change, at stored closes", async () => {
        const { store, writes, closeQueries } = fakeStore({
            states: [
                { portfolioId: "p1", cash: 100, lastChange: "2026-10-15T15:00:00Z" }, // imported Thursday morning
                { portfolioId: "p2", cash: 50, lastChange: "2026-10-16T22:00:00Z" }, // changed after Friday's close
            ],
            positions: { p1: [{ symbol: "AAPL", quantity: 10, avgCost: 150 }], p2: [{ symbol: "MSFT", quantity: 1, avgCost: 1 }] },
            bars: { AAPL: [[THU, 190], [FRI, 200]] },
        });

        const detail = await recordValuationSnapshots({ store });

        assert.deepEqual(detail, { latest: FRI, portfolios: 2, written: 2, partial: 0, provisional: 0, changedSinceClose: 1, waitingForSplits: 0 });
        assert.deepEqual(writes.map((write) => [write.portfolioId, write.snapshots.map((snapshot) => [snapshot.date, snapshot.totalValue])]), [
            ["p1", [[THU, 1_900 + 100], [FRI, 2_000 + 100]]],
        ]);
        // One read of closes, from a week before the earliest day.
        assert.deepEqual(closeQueries, [[["AAPL"], "2026-10-08", FRI]]);
    });

    test("recomputes a partial snapshot, and leaves complete ones alone", async () => {
        const { store, writes } = fakeStore({
            states: [{ portfolioId: "p1", cash: 0, lastChange: "2026-10-01T00:00:00Z" }],
            positions: { p1: [{ symbol: "AAPL", quantity: 1, avgCost: 1 }, { symbol: "NEW", quantity: 1, avgCost: 1 }] },
            bars: { AAPL: [[THU, 190], [FRI, 200]] },
            // Thursday is complete; Friday was partial (not in the complete set).
        });

        const detail = await recordValuationSnapshots({ store, max: 2 });

        assert.deepEqual(writes.map((write) => write.snapshots.map((snapshot) => [snapshot.date, snapshot.unpriced])), [[[THU, ["NEW"]], [FRI, ["NEW"]]]]);
        assert.deepEqual(detail, { latest: FRI, portfolios: 1, written: 2, partial: 2, provisional: 0, changedSinceClose: 0, waitingForSplits: 0 });

        const later = fakeStore({
            states: [{ portfolioId: "p1", cash: 0, lastChange: "2026-10-01T00:00:00Z" }],
            positions: { p1: [{ symbol: "AAPL", quantity: 1, avgCost: 1 }] },
            bars: { AAPL: [[THU, 190], [FRI, 200]] },
            complete: { p1: [THU, FRI] },
        });
        assert.deepEqual(await recordValuationSnapshots({ store: later.store, max: 2 }), {
            latest: FRI, portfolios: 1, written: 0, partial: 0, provisional: 0, changedSinceClose: 0, waitingForSplits: 0,
        });
        assert.deepEqual(later.writes, []);
    });

    test("no portfolios, nothing to do", async () => {
        const { store } = fakeStore();
        assert.deepEqual(await recordValuationSnapshots({ store }), {
            latest: FRI, portfolios: 0, written: 0, partial: 0, provisional: 0, changedSinceClose: 0, waitingForSplits: 0,
        });
    });

    test("regression: nothing is written until held positions are checked against splits through the latest close", async () => {
        const state = { portfolioId: "p1", cash: 0, lastChange: "2026-10-01T00:00:00Z" };
        // null: no price run has checked yet (undefined would pick the fake's default).
        for (const holdingSplits of [null, { skipped: "rate-limited" }, { from: "2026-09-01", to: THU }]) {
            const { store, writes } = fakeStore({ states: [state], positions: { p1: [{ symbol: "AAPL", quantity: 1, avgCost: 1 }] }, holdingSplits });
            const detail = await recordValuationSnapshots({ store, max: 2 });
            assert.ok("skipped" in detail, JSON.stringify(holdingSplits));
            assert.deepEqual(writes, []);
        }
    });

    test("regression: a portfolio holding a position from before an unapplied split waits; the others don't", async () => {
        const { store, writes } = fakeStore({
            states: [
                { portfolioId: "stale", cash: 0, lastChange: "2026-10-01T00:00:00Z" },
                { portfolioId: "reimported", cash: 0, lastChange: "2026-10-12T15:00:00Z" },
            ],
            positions: {
                // NVDA split on 2026-10-05 without a ratio: "stale" still has pre-split shares.
                stale: [{ symbol: "NVDA", quantity: 10, avgCost: 900, updatedAt: new Date("2026-10-01T00:00:00Z") }],
                reimported: [{ symbol: "NVDA", quantity: 100, avgCost: 90, updatedAt: new Date("2026-10-12T15:00:00Z") }],
            },
            bars: { NVDA: [[THU, 100], [FRI, 101]] },
            holdingSplits: { from: "2026-09-01", to: FRI, unadjusted: [{ symbol: "NVDA", executionDate: "2026-10-05" }] },
        });

        const detail = await recordValuationSnapshots({ store, max: 2 });

        assert.deepEqual(writes.map((write) => write.portfolioId), ["reimported"]);
        assert.equal((detail as { waitingForSplits: number }).waitingForSplits, 1);
    });

    test("a holding valued at an earlier day's close makes the snapshot provisional", async () => {
        const { store } = fakeStore({
            states: [{ portfolioId: "p1", cash: 0, lastChange: "2026-10-01T00:00:00Z" }],
            positions: { p1: [{ symbol: "HALTED", quantity: 1, avgCost: 1 }] },
            bars: { HALTED: [["2026-10-14", 5]] },
        });
        const detail = await recordValuationSnapshots({ store, max: 2 });
        assert.deepEqual([(detail as { provisional: number }).provisional, (detail as { partial: number }).partial], [2, 0]);
    });
});

describe("splitReadiness", () => {
    test("ready when the check succeeded through the latest close, or had nothing to check", () => {
        assert.deepEqual(splitReadiness({ from: "2026-09-01", to: FRI }, FRI), { ready: true, unadjusted: [] });
        assert.deepEqual(splitReadiness({ skipped: "nothing held" }, FRI), { ready: true, unadjusted: [] });
        assert.deepEqual(splitReadiness({ skipped: "up to date" }, FRI), { ready: true, unadjusted: [] });
    });

    test("not ready when the check failed, didn't run, or stopped short of the latest close", () => {
        for (const check of [undefined, null, "x", { skipped: "rate-limited" }, { skipped: "HTTP 502" }, { from: "2026-09-01", to: THU }, { from: "2026-09-01" }]) {
            assert.equal(splitReadiness(check, FRI).ready, false, JSON.stringify(check));
        }
    });

    test("passes on the splits that couldn't be applied, older undated entries included", () => {
        assert.deepEqual(splitReadiness({ to: FRI, unadjusted: [{ symbol: "nvda", executionDate: "2026-10-05" }, "BRK.B", { nope: 1 }] }, FRI), {
            ready: true,
            unadjusted: [{ symbol: "NVDA", executionDate: "2026-10-05" }, { symbol: "BRK.B", executionDate: null }],
        });
    });
});

describe("awaitsSplit", () => {
    const split = [{ symbol: "NVDA", executionDate: "2026-10-05" }];

    test("only a position last updated before the split took effect waits", () => {
        assert.equal(awaitsSplit({ symbol: "nvda", quantity: 1, avgCost: 1, updatedAt: new Date("2026-10-04T12:00:00Z") }, split), true);
        assert.equal(awaitsSplit({ symbol: "NVDA", quantity: 1, avgCost: 1, updatedAt: new Date("2026-10-05T12:00:00Z") }, split), false);
        assert.equal(awaitsSplit({ symbol: "AAPL", quantity: 1, avgCost: 1, updatedAt: new Date("2026-10-04T12:00:00Z") }, split), false);
    });

    test("without a split date or a position date, it waits", () => {
        assert.equal(awaitsSplit({ symbol: "NVDA", quantity: 1, avgCost: 1, updatedAt: new Date("2026-10-20T00:00:00Z") }, [{ symbol: "NVDA", executionDate: null }]), true);
        assert.equal(awaitsSplit({ symbol: "NVDA", quantity: 1, avgCost: 1 }, split), true);
    });
});

describe("createSnapshotStore", () => {
    test("reads portfolios and their holdings in one read-only repeatable-read transaction", async () => {
        let config: unknown;
        const database = {
            transaction: async (_body: unknown, options: unknown) => {
                config = options;
                throw new Error("stop here");
            },
        } as never;
        await assert.rejects(createSnapshotStore(database).portfolios(), /stop here/);
        assert.deepEqual(config, { isolationLevel: "repeatable read", accessMode: "read only" });
    });
});
