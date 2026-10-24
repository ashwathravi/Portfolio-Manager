import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { StoredClose } from "@/lib/portfolio/valuation-snapshots";
import {
    buildReturnHistory,
    buildUserAccountsQuery,
    buildUserSnapshotPositionsQuery,
    loadPageReturnHistory,
    type ReturnHistory,
    type ReturnHistoryRows,
} from "./return-history";

const MON = "2026-10-19";
const TUE = "2026-10-20";
const WED = "2026-10-21";

const rows: ReturnHistoryRows = {
    accounts: [{ id: "growth", name: "Growth" }, { id: "main", name: "Main" }, { id: "empty", name: "New IRA" }],
    snapshots: [
        { portfolioId: "growth", date: MON, totalValue: 7500 },
        { portfolioId: "main", date: MON, totalValue: 7000 },
        { portfolioId: "growth", date: TUE, totalValue: 7500 },
        { portfolioId: "main", date: TUE, totalValue: 7600 },
        { portfolioId: "growth", date: WED, totalValue: 8250 },
        { portfolioId: "main", date: WED, totalValue: 7600 },
    ],
    positions: [
        { portfolioId: "growth", date: MON, symbol: "PG", marketValue: 7500 },
        { portfolioId: "main", date: MON, symbol: "KO", marketValue: 6000 },
        { portfolioId: "growth", date: TUE, symbol: "PG", marketValue: 7500 },
        { portfolioId: "main", date: TUE, symbol: "KO", marketValue: 6600 },
        { portfolioId: "growth", date: WED, symbol: "PG", marketValue: 8250 },
        { portfolioId: "main", date: WED, symbol: "KO", marketValue: 6600 },
    ],
};

const stored: Record<string, Array<[string, number]>> = {
    KO: [[MON, 60], [TUE, 66], [WED, 66]],
    PG: [[MON, 150], [TUE, 150], [WED, 165]],
    SPY: [[MON, 500], [TUE, 510], [WED, 515.1]],
    QQQ: [[TUE, 420], [WED, 420]], // no close on Monday
};

function fakeCloses() {
    const calls: Array<{ symbols: string[]; from: string; to: string }> = [];
    const load = async (symbols: string[], from: string, to: string) => {
        calls.push({ symbols, from, to });
        const out = new Map<string, StoredClose[]>();
        for (const symbol of symbols) {
            const bars = stored[symbol];
            if (bars) out.set(symbol, bars.map(([date, close]) => ({ date, close })));
        }
        return out;
    };
    return { calls, load };
}

const near = (actual: number | null | undefined, expected: number) =>
    assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);

describe("return history queries", () => {
    test("accounts and snapshot positions are the user's only", () => {
        const accounts = buildUserAccountsQuery("user-a").toSQL();
        assert.match(accounts.sql, /where "portfolios"."user_id" = \$1/);
        assert.deepEqual(accounts.params, ["user-a"]);

        const all = buildUserSnapshotPositionsQuery("user-a").toSQL();
        assert.match(all.sql, /inner join "portfolios" on "portfolio_snapshot_positions"."portfolio_id" = "portfolios"."id"/);
        assert.match(all.sql, /where "portfolios"."user_id" = \$1/);
        assert.deepEqual(all.params, ["user-a"]);

        const one = buildUserSnapshotPositionsQuery("user-a", { portfolioId: "p1" }).toSQL();
        assert.match(one.sql, /"portfolios"."user_id" = \$1 and "portfolio_snapshot_positions"."portfolio_id" = \$2/);
        assert.deepEqual(one.params, ["user-a", "p1"]);
    });
});

describe("buildReturnHistory", () => {
    test("all accounts together by default, with every benchmark that has each date", async () => {
        const { calls, load } = fakeCloses();
        const history = await buildReturnHistory(rows, null, load);
        assert.equal(history.accountId, null);
        assert.equal(history.hasHistory, true);
        assert.deepEqual(history.accounts, [
            { id: "growth", name: "Growth", days: 3 },
            { id: "main", name: "Main", days: 3 },
            { id: "empty", name: "New IRA", days: 0 },
        ]);
        assert.deepEqual(history.points.map((p) => p.value), [14500, 15100, 15850]);
        near(history.points[1].stepReturn, 600 / 14500);
        near(history.points[2].stepReturn, 750 / 15100);
        // QQQ has no Monday close, so it isn't offered; IWM and DIA have none at all.
        assert.deepEqual(history.benchmarks.map((b) => b.symbol), ["SPY"]);
        assert.deepEqual(history.benchmarks[0].values.map((v) => v.value), [500, 510, 515.1]);
        // Closes from a week before the first date, for the held symbols and the benchmarks.
        assert.deepEqual(calls, [{ symbols: ["DIA", "IWM", "KO", "PG", "QQQ", "SPY"], from: "2026-10-12", to: WED }]);
    });

    test("one account", async () => {
        const { load } = fakeCloses();
        const main = rows.positions.filter((p) => p.portfolioId === "main");
        const history = await buildReturnHistory({ ...rows, positions: main }, "main", load);
        assert.equal(history.accountId, "main");
        assert.deepEqual(history.points.map((p) => p.value), [7000, 7600, 7600]);
        near(history.points[1].stepReturn, 600 / 7000);
        near(history.points[2].stepReturn, 0);
    });

    test("an account that isn't the user's shows all of theirs", async () => {
        const { load } = fakeCloses();
        const history = await buildReturnHistory(rows, "someone-elses", load);
        assert.equal(history.accountId, null);
        assert.equal(history.points.length, 3);
    });

    test("an account without snapshots has no points, but the user still has history", async () => {
        const { calls, load } = fakeCloses();
        const history = await buildReturnHistory({ ...rows, positions: [] }, "empty", load);
        assert.equal(history.accountId, "empty");
        assert.equal(history.hasHistory, true);
        assert.deepEqual(history.points, []);
        assert.deepEqual(history.benchmarks, []);
        assert.deepEqual(calls, []);
    });

    test("no snapshots at all", async () => {
        const { load } = fakeCloses();
        const history = await buildReturnHistory({ accounts: rows.accounts, snapshots: [], positions: [] }, null, load);
        assert.equal(history.hasHistory, false);
        assert.deepEqual(history.points, []);
    });
});

describe("loadPageReturnHistory", () => {
    const history: ReturnHistory = { accounts: [], accountId: null, hasHistory: false, points: [], benchmarks: [] };

    function recordingLoader(result: () => Promise<ReturnHistory>) {
        const calls: Array<{ userId: string; accountId?: string | null }> = [];
        const load = async (userId: string, { accountId }: { accountId?: string | null } = {}) => {
            calls.push({ userId, accountId });
            return result();
        };
        return { calls, load };
    }

    function silence(method: "warn" | "error") {
        const original = console[method];
        const calls: unknown[][] = [];
        console[method] = (...args: unknown[]) => calls.push(args);
        return { calls, restore: () => { console[method] = original; } };
    }

    test("loads the user's history, for the account asked for", async () => {
        const { calls, load } = recordingLoader(async () => history);
        const result = await loadPageReturnHistory("user-a", { accountId: "main" }, { databaseConfigured: true, load });

        assert.deepEqual(result, { history, unavailable: false });
        assert.deepEqual(calls, [{ userId: "user-a", accountId: "main" }]);
    });

    test("never queries without a configured database, so the example series shows", async () => {
        const { calls, load } = recordingLoader(async () => history);
        const warnings = silence("warn");
        const errors = silence("error");
        try {
            const result = await loadPageReturnHistory("user-a", { accountId: null }, { databaseConfigured: false, load });

            assert.deepEqual(result, { history: null, unavailable: false });
            assert.deepEqual(calls, []);
            assert.equal(warnings.calls.length + errors.calls.length, 0);
        } finally {
            warnings.restore();
            errors.restore();
        }
    });

    test("treats Vercel's \"[SENSITIVE]\" placeholder as no database by default", async () => {
        const original = process.env.DATABASE_URL;
        process.env.DATABASE_URL = "[SENSITIVE]";
        const { calls, load } = recordingLoader(async () => history);
        try {
            const result = await loadPageReturnHistory("user-a", {}, { load });

            assert.deepEqual(result, { history: null, unavailable: false });
            assert.deepEqual(calls, []);
        } finally {
            if (original === undefined) delete process.env.DATABASE_URL;
            else process.env.DATABASE_URL = original;
        }
    });

    test("a configured database that fails is an outage, logged without the AggregateError", async () => {
        // What postgres.js rejects with when neither of localhost's addresses answers.
        const refused = new AggregateError([
            new Error("connect ECONNREFUSED ::1:5432"),
            new Error("connect ECONNREFUSED 127.0.0.1:5432"),
        ], "");
        const { load } = recordingLoader(async () => { throw refused; });
        const errors = silence("error");
        try {
            const result = await loadPageReturnHistory("user-a", {}, { databaseConfigured: true, load });

            assert.deepEqual(result, { history: null, unavailable: true });
            assert.equal(errors.calls.length, 1);
            const [message, logged] = errors.calls[0];
            assert.match(String(message), /outage notice/);
            assert.ok(logged instanceof Error);
            assert.ok(!(logged instanceof AggregateError));
            assert.match(logged.message, /ECONNREFUSED ::1:5432; connect ECONNREFUSED 127\.0\.0\.1:5432/);
        } finally {
            errors.restore();
        }
    });
});
