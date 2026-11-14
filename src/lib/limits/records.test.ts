import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { RECORD_LIMITS, recordLimitCode, RecordLimitError, recordLimitMessage, recordLimitMessageFor } from "./records";
import { buildCountRecordsQuery, buildLockUserRecordsQuery } from "./records-server";

// Launch item i77: how many watchlist items, journal entries, theses and
// transactions one user keeps. The checks themselves run against a real
// database in scripts/db/record-limits.test.ts.

describe("record limits (launch item i77)", () => {
    test("each kind has its limit, its API code and a message that says what to do", () => {
        assert.deepEqual(RECORD_LIMITS, { watchlist: 500, journal: 2_000, theses: 200, transactions: 50_000 });
        assert.equal(recordLimitCode("watchlist"), "WATCHLIST_LIMIT");
        assert.equal(recordLimitCode("journal"), "JOURNAL_LIMIT");
        assert.equal(recordLimitCode("theses"), "THESIS_LIMIT");
        assert.equal(recordLimitCode("transactions"), "TRANSACTION_LIMIT");
        assert.equal(recordLimitMessage("watchlist"), "Your watchlist holds at most 500 tickers. Remove one to add another.");
        assert.equal(recordLimitMessage("journal"), "Your journal holds at most 2,000 entries. Delete one to add another.");
        assert.equal(recordLimitMessage("theses"), "You can keep at most 200 theses. Delete one to add another.");
        assert.equal(recordLimitMessage("transactions"), "Your accounts hold at most 50,000 transactions. Delete some to add more; nothing was added.");
        assert.equal(new RecordLimitError("theses").message, recordLimitMessage("theses"));
    });

    test("a page's refused save says the limit only when the API's code is that kind's", () => {
        const refused = (code: string | null) => Object.assign(new Error("Request failed (409)"), { status: 409, code });
        assert.equal(recordLimitMessageFor("watchlist", refused("WATCHLIST_LIMIT")), recordLimitMessage("watchlist"));
        assert.equal(recordLimitMessageFor("watchlist", refused("JOURNAL_LIMIT")), null);
        assert.equal(recordLimitMessageFor("journal", refused("DUPLICATE_TICKER")), null);
        assert.equal(recordLimitMessageFor("theses", refused(null)), null);
        assert.equal(recordLimitMessageFor("theses", new Error("offline")), null);
        assert.equal(recordLimitMessageFor("theses", null), null);
    });

    test("only live rows count: a removed item, entry or thesis kept as dismissed doesn't", () => {
        const watchlist = buildCountRecordsQuery("watchlist", "u-1").toSQL();
        assert.equal(watchlist.sql, 'select count(*) from "watchlist_items" where "watchlist_items"."user_id" = $1 and not "watchlist_items"."dismissed"');
        assert.deepEqual(watchlist.params, ["u-1"]);
        assert.match(buildCountRecordsQuery("journal", "u-1").toSQL().sql, /from "journal_entries" where "journal_entries"\."user_id" = \$1 and not "journal_entries"\."dismissed"$/);
        assert.match(buildCountRecordsQuery("theses", "u-1").toSQL().sql, /from "theses" where "theses"\."user_id" = \$1 and not "theses"\."dismissed"$/);
    });

    test("transactions count across all the user's accounts", () => {
        const { sql, params } = buildCountRecordsQuery("transactions", "u-1").toSQL();
        assert.equal(sql, 'select count(*) from "transactions" where "transactions"."portfolio_id" in (select "id" from "portfolios" where "portfolios"."user_id" = $1)');
        assert.deepEqual(params, ["u-1"]);
    });

    test("each user and kind has a lock of its own", () => {
        const recorded: unknown[] = [];
        const database = { execute: (query: unknown) => { recorded.push(query); return Promise.resolve(); } };
        void buildLockUserRecordsQuery("theses", "u-1", database as never);
        const chunks = JSON.stringify(recorded[0]);
        assert.match(chunks, /pg_advisory_xact_lock\(hashtext\(/);
        assert.match(chunks, /atlas:records:theses:u-1/);
    });
});
