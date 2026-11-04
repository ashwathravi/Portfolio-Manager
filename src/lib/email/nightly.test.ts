import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";

import {
    ALERT_EMAIL_MAX_AGE_DAYS,
    buildAlertsToEmailQuery,
    buildClaimAlertsQuery,
    buildClaimWeeklyReviewQuery,
    buildReleaseAlertsQuery,
    buildReleaseWeeklyReviewQuery,
    buildWeeklyReviewRecipientsQuery,
    sendScheduledEmails,
} from "./nightly";

const NOW = new Date("2026-10-30T22:40:00.000Z");

describe("email job queries (launch item i58)", () => {
    test("alerts to email: not read, cleared or emailed, raised since alert emails went on and in the last three days", () => {
        const { sql, params } = buildAlertsToEmailQuery(NOW).toSQL();
        assert.match(sql, /inner join "email_preferences" on "email_preferences"\."user_id" = "alert_notifications"\."user_id" inner join "auth_users" on "auth_users"\."id" = "alert_notifications"\."user_id"/);
        assert.match(sql, /where \("email_preferences"\."alerts" = \$1 and "auth_users"\."email" is not null and "alert_notifications"\."cleared" = \$2 and "alert_notifications"\."read_at" is null and "alert_notifications"\."emailed_at" is null and "alert_notifications"\."triggered_at" >= "email_preferences"\."alerts_since" and "alert_notifications"\."triggered_at" > \$3\)/);
        assert.match(sql, /order by "alert_notifications"\."user_id" asc, "alert_notifications"\."triggered_at" desc, "alert_notifications"\."id" asc$/);
        assert.deepEqual(params, [true, false, new Date(NOW.getTime() - ALERT_EMAIL_MAX_AGE_DAYS * 86_400_000).toISOString()]);
    });

    test("a claim takes only alerts no other run has, and a release gives back only this run's claim", () => {
        const claim = buildClaimAlertsQuery(["n-1", "n-2"], NOW).toSQL();
        assert.match(claim.sql, /^update "alert_notifications" set "emailed_at" = \$1 where \("alert_notifications"\."id" in \(\$2, \$3\) and "alert_notifications"\."emailed_at" is null and "alert_notifications"\."cleared" = \$4\) returning "id"$/);
        assert.deepEqual(claim.params, [NOW.toISOString(), "n-1", "n-2", false]);
        const release = buildReleaseAlertsQuery(["n-1"], NOW).toSQL();
        assert.match(release.sql, /^update "alert_notifications" set "emailed_at" = \$1 where \("alert_notifications"\."id" in \(\$2\) and "alert_notifications"\."emailed_at" = \$3\)$/);
        assert.deepEqual(release.params, [null, "n-1", NOW.toISOString()]);
    });

    test("the review goes to whoever wants it and hasn't had this week's", () => {
        const { sql, params } = buildWeeklyReviewRecipientsQuery("wk:2026-10-26").toSQL();
        assert.match(sql, /where \("email_preferences"\."weekly_review" = \$1 and "auth_users"\."email" is not null and \("email_preferences"\."weekly_review_week" is null or "email_preferences"\."weekly_review_week" <> \$2\)\)/);
        assert.deepEqual(params, [true, "wk:2026-10-26"]);
    });

    test("claiming a review needs the week the run read, so two runs can't both send it", () => {
        const claim = buildClaimWeeklyReviewQuery("u-1", "wk:2026-10-26", "wk:2026-10-19").toSQL();
        assert.match(claim.sql, /^update "email_preferences" set "weekly_review_week" = \$1 where \("email_preferences"\."user_id" = \$2 and "email_preferences"\."weekly_review" = \$3 and "email_preferences"\."weekly_review_week" is not distinct from \$4\) returning "user_id"$/);
        assert.deepEqual(claim.params, ["wk:2026-10-26", "u-1", true, "wk:2026-10-19"]);
        assert.deepEqual(buildClaimWeeklyReviewQuery("u-1", "wk:2026-10-26", null).toSQL().params.at(-1), null);
        const release = buildReleaseWeeklyReviewQuery("u-1", "wk:2026-10-26", null).toSQL();
        assert.match(release.sql, /^update "email_preferences" set "weekly_review_week" = \$1 where \("email_preferences"\."user_id" = \$2 and "email_preferences"\."weekly_review_week" = \$3\)$/);
        assert.deepEqual(release.params, [null, "u-1", "wk:2026-10-26"]);
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
