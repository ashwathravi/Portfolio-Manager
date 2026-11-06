import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";

import {
    ALERT_FEED_LIMIT,
    buildAlertFeedQuery,
    buildClearAlertsQuery,
    buildMarkReadQuery,
    buildUnreadCountQuery,
    loadAlertFeed,
} from "./notifications";

const USER = "00000000-0000-4000-8000-00000000a001";
const NOW = new Date("2026-11-02T22:35:00.000Z");

describe("alert feed queries (launch item i57)", () => {
    test("the feed is one user's alerts not cleared, newest first, up to its limit", () => {
        const { sql, params } = buildAlertFeedQuery(USER).toSQL();
        assert.match(sql, /from "alert_notifications" where \("alert_notifications"\."user_id" = \$1 and "alert_notifications"\."cleared" = \$2\) order by "alert_notifications"\."triggered_at" desc, "alert_notifications"\."id" desc limit \$3/);
        assert.deepEqual(params, [USER, false, ALERT_FEED_LIMIT]);
    });

    test("unread counts the user's alerts not cleared and not read, past the feed's limit too", () => {
        const { sql, params } = buildUnreadCountQuery(USER).toSQL();
        assert.match(sql, /^select count\(\*\) from "alert_notifications" where \("alert_notifications"\."user_id" = \$1 and "alert_notifications"\."cleared" = \$2 and "alert_notifications"\."read_at" is null\)$/);
        assert.deepEqual(params, [USER, false]);
    });

    test("marking read touches only the user's unread alerts: the ones named, or all", () => {
        const some = buildMarkReadQuery(USER, { ids: ["n-1", "n-2"] }, NOW).toSQL();
        assert.match(some.sql, /^update "alert_notifications" set "read_at" = \$1 where \("alert_notifications"\."user_id" = \$2 and "alert_notifications"\."read_at" is null and "alert_notifications"\."id" in \(\$3, \$4\)\)$/);
        assert.deepEqual(some.params, [NOW.toISOString(), USER, "n-1", "n-2"]);
        const all = buildMarkReadQuery(USER, { all: true }, NOW).toSQL();
        assert.match(all.sql, /where \("alert_notifications"\."user_id" = \$2 and "alert_notifications"\."read_at" is null\)$/);
        assert.deepEqual(all.params, [NOW.toISOString(), USER]);
    });

    test("clearing keeps each alert's record, its text erased and read, so it isn't raised again", () => {
        const { sql, params } = buildClearAlertsQuery(USER, NOW).toSQL();
        assert.doesNotMatch(sql, /^delete/);
        assert.match(sql, /^update "alert_notifications" set "message" = \$1, "href" = \$2, "read_at" = coalesce\("alert_notifications"\."read_at", \$3::timestamp\), "cleared" = \$4 where \("alert_notifications"\."user_id" = \$5 and "alert_notifications"\."cleared" = \$6\)$/);
        assert.deepEqual(params, ["", null, NOW.toISOString(), true, USER, false]);
    });
});

describe("loadAlertFeed", () => {
    test("reads each alert as the bell shows it, with the unread count", async () => {
        const rows = [{
            id: "n-1", userId: USER, ruleId: "r-1", occurrence: "session:2026-11-02", ruleName: "AAPL above $200",
            metric: "price", symbol: "AAPL", comparator: "gte", threshold: 200, observedValue: 210,
            message: "AAPL closed at $210.00 on Nov 2, at or above $200.00.", href: "/portfolios/detail/AAPL",
            triggeredAt: NOW, readAt: null, cleared: false,
        }, {
            id: "n-2", userId: USER, ruleId: "r-2", occurrence: "change:f:2026-Q3:filing:cusip:new", ruleName: "New positions",
            metric: "alpha_radar_new_position", symbol: null, comparator: "gte", threshold: 50, observedValue: 82,
            message: "Fund opened a new position in Chubb (CB) in 2026-Q3. Materiality 82/100.", href: null,
            triggeredAt: new Date("2026-11-01T22:35:00.000Z"), readAt: NOW, cleared: false,
        }];
        const database = {
            select: (fields?: unknown) => ({
                from: () => ({
                    where: () => (fields
                        ? Promise.resolve([{ value: 1 }])
                        : { orderBy: () => ({ limit: async () => rows }) }),
                }),
            }),
        } as unknown as typeof db;

        assert.deepEqual(await loadAlertFeed(USER, database), {
            unread: 1,
            notifications: [{
                id: "n-1", ruleId: "r-1", ruleName: "AAPL above $200", metric: "price", symbol: "AAPL", comparator: "gte",
                threshold: 200, observedValue: 210, triggeredAt: NOW.toISOString(), acknowledged: false, source: "market",
                message: "AAPL closed at $210.00 on Nov 2, at or above $200.00.", href: "/portfolios/detail/AAPL",
            }, {
                id: "n-2", ruleId: "r-2", ruleName: "New positions", metric: "alpha_radar_new_position", comparator: "gte",
                threshold: 50, observedValue: 82, triggeredAt: "2026-11-01T22:35:00.000Z", acknowledged: true, source: "alpha_radar",
                message: "Fund opened a new position in Chubb (CB) in 2026-Q3. Materiality 82/100.",
            }],
        });
    });
});
