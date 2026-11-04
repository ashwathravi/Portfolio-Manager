import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";
import { unsubscribeTokenSchema } from "@/lib/validators/email";

import {
    buildLoadEmailPreferencesQuery,
    buildSaveEmailPreferencesQuery,
    buildUnsubscribeQuery,
    loadEmailPreferences,
    newUnsubscribeToken,
} from "./preferences";

const USER = "00000000-0000-4000-8000-00000000a001";
const NOW = new Date("2026-11-03T15:00:00.000Z");
const TOKEN = "t".repeat(43);

describe("email preference queries (launch item i58)", () => {
    test("loading reads the user's address with their choices, which may not exist yet", () => {
        const { sql, params } = buildLoadEmailPreferencesQuery(USER).toSQL();
        assert.match(sql, /^select "auth_users"\."email", "email_preferences"\."alerts", "email_preferences"\."weekly_review" from "auth_users" left join "email_preferences" on "email_preferences"\."user_id" = "auth_users"\."id" where "auth_users"\."id" = \$1 limit \$2$/);
        assert.deepEqual(params, [USER, 1]);
    });

    test("turning alert emails on starts them now, unless they were already on; the review switch is left alone", () => {
        const { sql, params } = buildSaveEmailPreferencesQuery(USER, { alerts: true }, NOW, TOKEN).toSQL();
        assert.match(sql, /^insert into "email_preferences" \("user_id", "alerts", "weekly_review", "alerts_since", "weekly_review_week", "unsubscribe_token", "updated_at"\) values \(\$1, \$2, \$3, \$4, default, \$5, \$6\) on conflict \("user_id"\) do update set "alerts" = \$7, "alerts_since" = case when "email_preferences"\."alerts" then "email_preferences"\."alerts_since" else \$8::timestamp end, "updated_at" = \$9 returning "alerts", "weekly_review"$/);
        assert.deepEqual(params, [USER, true, false, NOW.toISOString(), TOKEN, NOW.toISOString(), true, NOW.toISOString(), NOW.toISOString()]);
        assert.doesNotMatch(sql.split(" do update ")[1], /unsubscribe_token|weekly_review" =/, "an existing row keeps its token and the other switch");
    });

    test("turning one off changes only it", () => {
        const off = buildSaveEmailPreferencesQuery(USER, { alerts: false }, NOW, TOKEN).toSQL();
        assert.match(off.sql, /do update set "alerts" = \$\d+, "updated_at" = \$\d+ returning/);
        const review = buildSaveEmailPreferencesQuery(USER, { weeklyReview: true }, NOW, TOKEN).toSQL();
        assert.match(review.sql, /do update set "weekly_review" = \$\d+, "updated_at" = \$\d+ returning/);
        assert.deepEqual(review.params.slice(1, 4), [false, true, null], "a first save leaves alerts off, with no start");
    });

    test("an unsubscribe link turns off its one email for whoever holds the token", () => {
        const alerts = buildUnsubscribeQuery(TOKEN, "alerts", NOW).toSQL();
        assert.match(alerts.sql, /^update "email_preferences" set "alerts" = \$1, "updated_at" = \$2 where "email_preferences"\."unsubscribe_token" = \$3 returning "user_id"$/);
        assert.deepEqual(alerts.params, [false, NOW.toISOString(), TOKEN]);
        assert.match(buildUnsubscribeQuery(TOKEN, "weekly_review", NOW).toSQL().sql, /^update "email_preferences" set "weekly_review" = \$1, "updated_at" = \$2 where/);
    });
});

describe("newUnsubscribeToken", () => {
    test("is 43 base64url characters, a new one each time", () => {
        const a = newUnsubscribeToken();
        assert.equal(unsubscribeTokenSchema.safeParse(a).success, true, a);
        assert.notEqual(a, newUnsubscribeToken());
    });
});

describe("loadEmailPreferences", () => {
    const databaseWith = (rows: unknown[]) => ({
        select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => rows }) }) }) }),
    }) as unknown as typeof db;

    test("both off, with the address, before any choice", async () => {
        assert.deepEqual(await loadEmailPreferences(USER, databaseWith([{ address: "a@example.test", alerts: null, weeklyReview: null }])), {
            alerts: false, weeklyReview: false, address: "a@example.test",
        });
    });

    test("the user's choices once made", async () => {
        assert.deepEqual(await loadEmailPreferences(USER, databaseWith([{ address: "a@example.test", alerts: true, weeklyReview: false }])), {
            alerts: true, weeklyReview: false, address: "a@example.test",
        });
        assert.deepEqual(await loadEmailPreferences(USER, databaseWith([])), { alerts: false, weeklyReview: false, address: null });
    });
});
