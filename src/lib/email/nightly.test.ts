import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";

import {
    ALERT_EMAIL_MAX_AGE_DAYS,
    alertsByUser,
    buildAlertsSentQuery,
    buildAlertsToEmailQuery,
    buildClaimAlertsQuery,
    buildClaimWeeklyReviewQuery,
    buildReleaseAlertsQuery,
    buildReleaseWeeklyReviewQuery,
    buildWeeklyReviewDoneQuery,
    buildWeeklyReviewRecipientsQuery,
    EMAIL_CLAIM_TTL_MS,
    sendScheduledEmails,
} from "./nightly";

const NOW = new Date("2026-10-30T22:40:00.000Z");
const LAPSED = new Date(NOW.getTime() - EMAIL_CLAIM_TTL_MS).toISOString();
const CLAIMABLE = /\("([a-z_]+)"\."(email_claimed_at|weekly_review_claimed_at)" is null or "\1"\."\2" < \$(\d+)\)/;

describe("email job queries (launch item i58)", () => {
    test("alerts to email: not read, cleared, sent or claimed by a live run, raised since alert emails went on and in the last four days", () => {
        const { sql, params } = buildAlertsToEmailQuery(NOW).toSQL();
        assert.match(sql, /inner join "email_preferences" on "email_preferences"\."user_id" = "alert_notifications"\."user_id" inner join "auth_users" on "auth_users"\."id" = "alert_notifications"\."user_id"/);
        assert.match(sql, /where \("email_preferences"\."alerts" = \$1 and "auth_users"\."email" is not null and "alert_notifications"\."cleared" = \$2 and "alert_notifications"\."read_at" is null and "alert_notifications"\."emailed_at" is null and \("alert_notifications"\."email_claimed_at" is null or "alert_notifications"\."email_claimed_at" < \$3\) and "alert_notifications"\."triggered_at" >= "email_preferences"\."alerts_since" and "alert_notifications"\."triggered_at" > \$4\)/);
        assert.deepEqual(params, [true, false, LAPSED, new Date(NOW.getTime() - ALERT_EMAIL_MAX_AGE_DAYS * 86_400_000).toISOString()]);
    });

    test("a claim takes alerts no live run has; sending marks them sent, failing gives back only this run's claim", () => {
        const claim = buildClaimAlertsQuery(["n-1", "n-2"], NOW).toSQL();
        assert.match(claim.sql, /^update "alert_notifications" set "email_claimed_at" = \$1 where \("alert_notifications"\."id" in \(\$2, \$3\) and "alert_notifications"\."emailed_at" is null and "alert_notifications"\."cleared" = \$4 and /);
        assert.match(claim.sql, CLAIMABLE);
        assert.match(claim.sql, /\) returning "id"$/);
        assert.deepEqual(claim.params, [NOW.toISOString(), "n-1", "n-2", false, LAPSED]);

        const sent = buildAlertsSentQuery(["n-1"], NOW).toSQL();
        assert.match(sent.sql, /^update "alert_notifications" set "emailed_at" = \$1, "email_claimed_at" = \$2 where \("alert_notifications"\."id" in \(\$3\) and "alert_notifications"\."email_claimed_at" = \$4\)$/);
        assert.deepEqual(sent.params, [NOW.toISOString(), null, "n-1", NOW.toISOString()]);

        const release = buildReleaseAlertsQuery(["n-1"], NOW).toSQL();
        assert.match(release.sql, /^update "alert_notifications" set "email_claimed_at" = \$1 where \("alert_notifications"\."id" in \(\$2\) and "alert_notifications"\."email_claimed_at" = \$3\)$/);
        assert.deepEqual(release.params, [null, "n-1", NOW.toISOString()]);
    });

    test("the review goes to whoever wants it, hasn't had this week's and isn't being sent it", () => {
        const { sql, params } = buildWeeklyReviewRecipientsQuery("wk:2026-10-26", NOW).toSQL();
        assert.match(sql, /where \("email_preferences"\."weekly_review" = \$1 and "auth_users"\."email" is not null and "email_preferences"\."weekly_review_week" is distinct from \$2 and /);
        assert.match(sql, CLAIMABLE);
        assert.deepEqual(params, [true, "wk:2026-10-26", LAPSED]);
    });

    test("a review claim lapses like an alert's; done records the week, release only clears this run's claim", () => {
        const claim = buildClaimWeeklyReviewQuery("u-1", "wk:2026-10-26", NOW).toSQL();
        assert.match(claim.sql, /^update "email_preferences" set "weekly_review_claimed_at" = \$1 where \("email_preferences"\."user_id" = \$2 and "email_preferences"\."weekly_review" = \$3 and "email_preferences"\."weekly_review_week" is distinct from \$4 and /);
        assert.match(claim.sql, CLAIMABLE);
        assert.deepEqual(claim.params, [NOW.toISOString(), "u-1", true, "wk:2026-10-26", LAPSED]);

        const done = buildWeeklyReviewDoneQuery("u-1", "wk:2026-10-26", NOW).toSQL();
        assert.match(done.sql, /^update "email_preferences" set "weekly_review_week" = \$1, "weekly_review_claimed_at" = \$2 where \("email_preferences"\."user_id" = \$3 and "email_preferences"\."weekly_review_claimed_at" = \$4\)$/);
        assert.deepEqual(done.params, ["wk:2026-10-26", null, "u-1", NOW.toISOString()]);

        const release = buildReleaseWeeklyReviewQuery("u-1", NOW).toSQL();
        assert.match(release.sql, /^update "email_preferences" set "weekly_review_claimed_at" = \$1 where \("email_preferences"\."user_id" = \$2 and "email_preferences"\."weekly_review_claimed_at" = \$3\)$/);
        assert.deepEqual(release.params, [null, "u-1", NOW.toISOString()]);
    });
});

describe("alertsByUser", () => {
    const row = (id: string, userId: string, triggeredAt: string) => ({
        id, userId, triggeredAt: new Date(triggeredAt), message: id, metric: "price", symbol: "AAPL", href: null, address: `${userId}@example.test`, token: "t",
    });

    test("each user's alerts newest first; whoever has waited longest goes first, so nobody is put off night after night", () => {
        const groups = alertsByUser([
            row("a-new", "u-a", "2026-11-02T22:35:00Z"),
            row("b-old", "u-b", "2026-10-30T22:35:00Z"),
            row("b-new", "u-b", "2026-11-02T22:35:00Z"),
            row("c-1", "u-c", "2026-11-02T22:35:00Z"),
        ]);
        assert.deepEqual(groups.map((alerts) => alerts.map((alert) => alert.id)), [["b-new", "b-old"], ["a-new"], ["c-1"]]);
    });
});

describe("sendScheduledEmails", () => {
    test("without Resend's key and a sender it reads nothing and says why", async () => {
        const untouchable = new Proxy({}, { get: () => { throw new Error("the database was read"); } }) as typeof db;
        assert.deepEqual(await sendScheduledEmails({ database: untouchable, env: { APP_URL: "https://atlas.example.test" }, now: NOW }), {
            skipped: "Email is not configured: RESEND_API_KEY and EMAIL_FROM are not set.",
        });
    });
});
