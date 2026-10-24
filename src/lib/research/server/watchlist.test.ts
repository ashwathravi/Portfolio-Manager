import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";
import type { WatchItemInput } from "@/lib/validators/watchlist";

import {
    DuplicateTickerError,
    buildImportWatchlistQuery,
    buildListWatchlistQuery,
    buildSaveWatchItemQuery,
    importWatchlist,
    loadWatchlist,
    saveWatchItem,
} from "./watchlist";

const USER = "00000000-0000-4000-8000-00000000a001";
const NOW = new Date("2026-10-23T08:00:00.000Z");
const ORDER = { session: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", seq: 7 };

const ITEM: WatchItemInput = {
    id: "w-nvda-mgx2k1",
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    reason: "Data-centre demand",
    notes: "",
    targetEntry: 120.5,
    addedAt: "2026-10-23",
    dismissed: false,
};

function row(item: WatchItemInput, createdAt = NOW) {
    return { userId: USER, ...item, createdAt, updatedAt: createdAt };
}

describe("watchlist queries", () => {
    test("list reads one user's rows, newest first", () => {
        const { sql, params } = buildListWatchlistQuery(USER).toSQL();
        assert.match(sql, /from "watchlist_items" where "watchlist_items"\."user_id" = \$1 order by "watchlist_items"\."created_at" desc, "watchlist_items"\."id" asc/i);
        assert.deepEqual(params, [USER]);
    });

    test("save adds the item or replaces the user's row with that id", () => {
        const { sql, params } = buildSaveWatchItemQuery(USER, ITEM, ORDER, NOW).toSQL();
        assert.match(sql, /insert into "watchlist_items" \("user_id", "id", "ticker", "company_name", "reason", "notes", "target_entry", "added_at", "dismissed", "write_session", "write_seq", "created_at", "updated_at"\)/i);
        assert.match(sql, /on conflict \("user_id","id"\) do update set "ticker" = \$\d+, "company_name" = \$\d+, "reason" = \$\d+, "notes" = \$\d+, "target_entry" = \$\d+, "added_at" = \$\d+, "dismissed" = \$\d+, "write_session" = \$\d+, "write_seq" = \$\d+, "updated_at" = \$\d+ where/i);
        // The created time is kept: it orders the list.
        assert.doesNotMatch(sql.split("do update")[1] ?? "", /created_at/);
        assert.equal(params[0], USER);
        assert.equal(params[1], ITEM.id);
        assert.ok(params.includes(NOW.toISOString()));
        assert.ok(params.includes(ORDER.session));
        assert.ok(params.includes(ORDER.seq));
    });

    test("regression: a late write from the same page can't replace a newer one", () => {
        // The Codex finding on PR #147: two writes in flight as a page
        // closes could land out of order.
        const { sql } = buildSaveWatchItemQuery(USER, ITEM, ORDER, NOW).toSQL();
        assert.match(sql, /do update set .* where \("watchlist_items"\."write_session" is distinct from \$\d+ or "watchlist_items"\."write_seq" < \$\d+\)$/i);
    });

    test("regression: a removal keeps the row, its text cleared, so a late save can't bring it back", () => {
        // The Codex finding on PR #147: a DELETE that landed first left no
        // row for the order check, and the older PUT inserted it again.
        const removed = { ...ITEM, dismissed: true };
        const { sql, params } = buildSaveWatchItemQuery(USER, removed, ORDER, NOW).toSQL();
        assert.match(sql, /^insert into "watchlist_items"/i);
        assert.match(sql, /where \("watchlist_items"\."write_session" is distinct from \$\d+ or "watchlist_items"\."write_seq" < \$\d+\)$/i);
        assert.ok(params.includes(true));
        assert.ok(params.includes(ITEM.ticker));
        for (const text of [ITEM.companyName, ITEM.reason]) assert.ok(!params.includes(text), text);
        assert.ok(!params.includes(ITEM.targetEntry));
    });

    test("import keeps the browser's order and leaves rows the user already has", () => {
        const second = { ...ITEM, id: "w-amd-mgx2k0", ticker: "AMD" };
        const { sql, params } = buildImportWatchlistQuery(USER, { items: [ITEM, second] }, NOW).toSQL();
        assert.match(sql, /on conflict do nothing$/i);
        // No page wrote these yet.
        assert.match(sql, /"write_session", "write_seq"/);
        // Created a millisecond apart, the first newest.
        assert.ok(params.includes(NOW.toISOString()));
        assert.ok(params.includes(new Date(NOW.getTime() - 1).toISOString()));
        assert.ok(params.indexOf(ITEM.id) < params.indexOf(second.id));
    });

    test("regression: a later batch continues the first one's order", () => {
        // The Codex finding on PR #147: each batch counted from its own
        // arrival, so later (older) items sorted above the newest ones.
        const startedAt = NOW.getTime() - 5_000;
        const later = new Date(NOW.getTime() + 2_000);
        const { params } = buildImportWatchlistQuery(USER, { items: [ITEM], first: 500, startedAt }, later).toSQL();
        assert.ok(params.includes(new Date(startedAt - 500).toISOString()));
        // A start time in the future counts as now.
        const ahead = buildImportWatchlistQuery(USER, { items: [ITEM], startedAt: NOW.getTime() + 60_000 }, NOW).toSQL();
        assert.ok(ahead.params.includes(NOW.toISOString()));
    });
});

describe("loadWatchlist", () => {
    test("separates the user's items from the examples they removed", async () => {
        const dismissed = { ...ITEM, id: "w-coin", ticker: "COIN", dismissed: true };
        const rows = [row(ITEM), row(dismissed)];
        const database = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }) } as unknown as typeof db;

        assert.deepEqual(await loadWatchlist(USER, database), { items: [ITEM], dismissed: ["w-coin"] });
    });
});

describe("saveWatchItem", () => {
    function failingDatabase(error: unknown) {
        return {
            insert: () => ({ values: () => ({ onConflictDoUpdate: async () => { throw error; } }) }),
        } as unknown as typeof db;
    }

    test("reports a live row with the same ticker as a duplicate", async () => {
        // As drizzle wraps the driver's error.
        const error = new Error("Failed query", {
            cause: Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "watchlist_items_user_ticker_idx" }),
        });
        await assert.rejects(saveWatchItem(USER, ITEM, ORDER, { database: failingDatabase(error) }), (err: unknown) => {
            assert.ok(err instanceof DuplicateTickerError);
            assert.equal(err.ticker, "NVDA");
            return true;
        });
    });

    test("passes other failures on", async () => {
        const other = Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "watchlist_items_pkey" });
        await assert.rejects(saveWatchItem(USER, ITEM, ORDER, { database: failingDatabase(other) }), (err: unknown) => err === other);
        const down = new Error("connect ECONNREFUSED");
        await assert.rejects(saveWatchItem(USER, ITEM, ORDER, { database: failingDatabase(down) }), (err: unknown) => err === down);
    });
});

describe("importWatchlist", () => {
    test("writes nothing for an empty list", async () => {
        const database = { insert: () => assert.fail("nothing to insert") } as unknown as typeof db;
        await importWatchlist(USER, { items: [] }, { database });
    });
});
