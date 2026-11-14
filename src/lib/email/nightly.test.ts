import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";

import {
    ALERT_EMAIL_MAX_AGE_DAYS,
    alertBatches,
    alertsByUser,
    buildAlertsSentQuery,
    buildAlertsToEmailQuery,
    buildClaimAlertBatchQuery,
    buildClaimAlertsQuery,
    buildDropAlertBatchQuery,
    buildPendingAlertBatchesQuery,
    buildClaimWeeklyReviewQuery,
    buildReleaseAlertsQuery,
    buildReleaseWeeklyReviewQuery,
    buildWeeklyReviewDoneQuery,
    buildWeeklyReviewRecipientsQuery,
    EMAIL_CLAIM_TTL_MS,
    sendScheduledEmails,
    weeklyReviewDue,
} from "./nightly";

const NOW = new Date("2026-10-30T22:40:00.000Z");
const LAPSED = new Date(NOW.getTime() - EMAIL_CLAIM_TTL_MS).toISOString();
const CLAIMABLE = /\("([a-z_]+)"\."(email_claimed_at|weekly_review_claimed_at)" is null or "\1"\."\2" < \$(\d+)\)/;

describe("email job queries (launch item i58)", () => {
    test("alerts to email: not read, cleared, sent, in an email already or claimed by a live run, raised since alert emails went on and in the last four days", () => {
        const { sql, params } = buildAlertsToEmailQuery(NOW).toSQL();
        assert.match(sql, /inner join "email_preferences" on "email_preferences"\."user_id" = "alert_notifications"\."user_id" inner join "auth_users" on "auth_users"\."id" = "alert_notifications"\."user_id"/);
        assert.match(sql, /where \("email_preferences"\."alerts" = \$1 and "auth_users"\."email" is not null and "alert_notifications"\."cleared" = \$2 and "alert_notifications"\."read_at" is null and "alert_notifications"\."emailed_at" is null and "alert_notifications"\."email_batch" is null and \("alert_notifications"\."email_claimed_at" is null or "alert_notifications"\."email_claimed_at" < \$3\) and "alert_notifications"\."triggered_at" >= "email_preferences"\."alerts_since" and "alert_notifications"\."triggered_at" > \$4\)/);
        assert.deepEqual(params, [true, false, LAPSED, new Date(NOW.getTime() - ALERT_EMAIL_MAX_AGE_DAYS * 86_400_000).toISOString()]);
    });

    test("a claim puts alerts no live run has, and in no email yet, in a new email; that email is then marked sent, given back or broken up", () => {
        const claim = buildClaimAlertsQuery(["n-1", "n-2"], "alerts/b-1", NOW).toSQL();
        assert.match(claim.sql, /^update "alert_notifications" set "email_claimed_at" = \$1, "email_batch" = \$2 where \("alert_notifications"\."id" in \(\$3, \$4\) and "alert_notifications"\."emailed_at" is null and "alert_notifications"\."email_batch" is null and "alert_notifications"\."cleared" = \$5 and /);
        assert.match(claim.sql, CLAIMABLE);
        assert.match(claim.sql, /\) returning "id"$/);
        assert.deepEqual(claim.params, [NOW.toISOString(), "alerts/b-1", "n-1", "n-2", false, LAPSED]);

        const sent = buildAlertsSentQuery("alerts/b-1", NOW).toSQL();
        assert.match(sent.sql, /^update "alert_notifications" set "emailed_at" = \$1, "email_claimed_at" = \$2 where \("alert_notifications"\."email_batch" = \$3 and "alert_notifications"\."email_claimed_at" = \$4\)$/);
        assert.deepEqual(sent.params, [NOW.toISOString(), null, "alerts/b-1", NOW.toISOString()]);

        // An unknown outcome keeps the email for a later run.
        const release = buildReleaseAlertsQuery("alerts/b-1", NOW).toSQL();
        assert.match(release.sql, /^update "alert_notifications" set "email_claimed_at" = \$1 where \("alert_notifications"\."email_batch" = \$2 and "alert_notifications"\."email_claimed_at" = \$3\)$/);
        assert.deepEqual(release.params, [null, "alerts/b-1", NOW.toISOString()]);

        // A refused one frees its alerts.
        const drop = buildDropAlertBatchQuery("alerts/b-1", NOW).toSQL();
        assert.match(drop.sql, /^update "alert_notifications" set "email_claimed_at" = \$1, "email_batch" = \$2 where \("alert_notifications"\."email_batch" = \$3 and "alert_notifications"\."email_claimed_at" = \$4\)$/);
        assert.deepEqual(drop.params, [null, null, "alerts/b-1", NOW.toISOString()]);
    });

    test("emails an earlier run may have sent: every alert in them, cleared ones too, unless a live run has them", () => {
        const pending = buildPendingAlertBatchesQuery(NOW).toSQL();
        assert.match(pending.sql, /"alert_notifications"\."email_batch", "alert_notifications"\."cleared", "email_preferences"\."alerts" from "alert_notifications"/);
        assert.match(pending.sql, /where \("alert_notifications"\."email_batch" is not null and "alert_notifications"\."emailed_at" is null and /);
        assert.match(pending.sql, CLAIMABLE);
        assert.doesNotMatch(pending.sql, /"read_at" is null|"cleared" = /);
        assert.deepEqual(pending.params, [LAPSED]);

        const claim = buildClaimAlertBatchQuery("alerts/b-1", NOW).toSQL();
        assert.match(claim.sql, /^update "alert_notifications" set "email_claimed_at" = \$1 where \("alert_notifications"\."email_batch" = \$2 and "alert_notifications"\."emailed_at" is null and /);
        assert.match(claim.sql, CLAIMABLE);
        assert.deepEqual(claim.params, [NOW.toISOString(), "alerts/b-1", LAPSED]);
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

    test("alertBatches groups an earlier run's emails the same way, by email rather than user", () => {
        const pending = (id: string, batch: string, triggeredAt: string) => ({ ...row(id, "u-a", triggeredAt), batch, cleared: false, alertsOn: true });
        const groups = alertBatches([
            pending("x-1", "alerts/x", "2026-11-02T22:35:00Z"),
            pending("y-1", "alerts/y", "2026-11-02T22:35:00Z"),
            pending("y-0", "alerts/y", "2026-10-30T22:35:00Z"),
        ]);
        assert.deepEqual(groups.map((alerts) => alerts.map((alert) => alert.id)), [["y-1", "y-0"], ["x-1"]]);
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

describe("weeklyReviewDue: which week's review a run sends, on the NYSE calendar (#202)", () => {
    /** Runs `fn` with the process in another time zone. */
    function inZone<T>(zone: string, fn: () => T): T {
        const previous = process.env.TZ;
        process.env.TZ = zone;
        try {
            return fn();
        } finally {
            if (previous === undefined) delete process.env.TZ;
            else process.env.TZ = previous;
        }
    }
    // The zones #202's week tests cover.
    const ZONES = ["America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Tokyo", "Pacific/Auckland"];
    const due = (iso: string) => weeklyReviewDue(new Date(iso))?.id ?? null;
    const everywhere = (check: () => void) => { for (const zone of ZONES) inZone(zone, check); };

    test("from the week's Friday close until four days later, the same in every time zone", () => everywhere(() => {
        // Friday Oct 30, 2026: the close is 4 PM EDT, 20:00 UTC.
        assert.equal(due("2026-10-30T19:59:00Z"), null);
        assert.equal(due("2026-10-30T20:00:00Z"), "wk:2026-10-26");
        assert.equal(due("2026-10-30T22:35:00Z"), "wk:2026-10-26");
        assert.equal(due("2026-11-02T22:35:00Z"), "wk:2026-10-26", "Monday's run can still send it");
        assert.equal(due("2026-11-03T22:35:00Z"), null, "Tuesday's run is too late");
    }));

    test("regression: a week whose Friday is a holiday is due from Thursday's close, a 1 PM close included", () => everywhere(() => {
        // Christmas 2026 is a Friday; Thursday Dec 24 closes at 1 PM EST, 18:00 UTC.
        assert.equal(due("2026-12-24T17:59:00Z"), null);
        assert.equal(due("2026-12-24T18:00:00Z"), "wk:2026-12-21");
        assert.equal(due("2026-12-24T22:35:00Z"), "wk:2026-12-21", "Thursday evening's run sends it");
        assert.equal(due("2026-12-25T22:35:00Z"), "wk:2026-12-21");
        // Four days after Thursday's close.
        assert.equal(due("2026-12-28T17:59:00Z"), "wk:2026-12-21");
        assert.equal(due("2026-12-28T18:00:00Z"), null);
    }));

    test("regression: the day after Thanksgiving it is due from the 1 PM close", () => everywhere(() => {
        // Friday Nov 27, 2026 closes at 1 PM EST, 18:00 UTC.
        assert.equal(due("2026-11-27T17:59:00Z"), null);
        assert.equal(due("2026-11-27T18:00:00Z"), "wk:2026-11-23");
    }));
});
