/**
 * The nightly "email" job (launch item i58), after the alerts job. Each user
 * who asked for them gets:
 *
 *   - one email with the alerts raised since their last, leaving out the
 *     ones read or cleared in the app, those from before alert emails were
 *     turned on, and any over four days old (so Friday's still go on
 *     Monday);
 *   - after Friday's close, the week's review of the trades they closed
 *     (src/lib/reviews), as Today shows it. Not sent for a week without
 *     closed trades. A run up to Tuesday's close can still send it when
 *     Friday's couldn't.
 *
 * Every email is claimed before it's sent (its alerts' email_claimed_at, the
 * user's weekly_review_claimed_at) and marked sent once Resend accepts it
 * (emailed_at, weekly_review_week). A refused one is released at once; a
 * claim never marked sent, because the run was cut off, lapses after
 * {@link EMAIL_CLAIM_TTL_MS} and a later run takes it again, under the same
 * idempotency key while it holds the same alerts. So two runs never send an
 * email twice, and none is lost.
 *
 * Sends are spaced to keep within Resend's rate limit and stop when the
 * job's budget is spent; the rest go the next evening. Users whose alerts
 * have waited longest go first, so nobody is put off night after night,
 * and while reviews are due the alerts may use only half the budget. Any
 * failed send fails the run, after the others have gone, so the job's
 * health shows it.
 */

import { createHash } from "node:crypto";

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { alertNotifications, authUsers, emailPreferences } from "@/db/schema";
import type { AlertMetric } from "@/lib/alerts/types";
import { loadTradeJournal } from "@/lib/journal/server";
import type { TradeJournal } from "@/lib/journal/trades";
import { generateReview } from "@/lib/reviews/generate";
import { easternWeekBounds } from "@/lib/reviews/weeks";

import { emailSetup, type EmailConfig } from "./config";
import { resendSender, type OutgoingEmail, type SendEmail } from "./resend";
import { alertsEmail, unsubscribeHeaders, unsubscribeUrls, weeklyReviewEmail, type RenderedEmail } from "./templates";

type Database = typeof db;
type Env = Readonly<Record<string, string | undefined>>;

export const EMAIL_JOB = "email";
/** Alerts older than this aren't emailed: they'd be news no longer. Covers a weekend without runs. */
export const ALERT_EMAIL_MAX_AGE_DAYS = 4;
/** A week's review goes on a run from Friday's 4 PM close until this long after it (Tuesday's). */
export const WEEKLY_REVIEW_SEND_DAYS = 4;
/** Between sends: Resend allows two requests a second by default. */
export const SEND_SPACING_MS = 500;
/** No email is started after this; the nightly run's five minutes are mostly the price job's. */
export const EMAIL_JOB_BUDGET_MS = 15_000;
/**
 * A claim this old that was never marked sent was cut off: the cron route
 * stops at five minutes, and one run goes at a time.
 */
export const EMAIL_CLAIM_TTL_MS = 15 * 60_000;

const DAY_MS = 86_400_000;

export interface EmailJobDetail {
    skipped?: string;
    alerts?: { sent: number; failed: number; deferred: number };
    weeklyReview?: { week: string; sent: number; noTrades: number; failed: number; deferred: number } | { week: null };
}

export interface EmailJobDeps {
    now?: Date;
    database?: Database;
    env?: Env;
    /** Sends one email; Resend with the environment's key when omitted. */
    send?: SendEmail;
    loadJournal?: (userId: string, now: Date) => Promise<TradeJournal>;
    /** Waits between sends. */
    pause?: (ms: number) => Promise<void>;
    /** Milliseconds, for the budget. */
    clock?: () => number;
    budgetMs?: number;
}

// ---------------------------------------------------------------------------
// Queries (compiled in tests)
// ---------------------------------------------------------------------------

/** Not claimed, or claimed by a run that was cut off. */
function claimable(claimedAt: PgColumn, now: Date): SQL {
    return or(isNull(claimedAt), lt(claimedAt, new Date(now.getTime() - EMAIL_CLAIM_TTL_MS)))!;
}

/** The alerts waiting to be emailed, each user's newest first, with where they go. */
export function buildAlertsToEmailQuery(now: Date, database: Database = db) {
    return database
        .select({
            id: alertNotifications.id,
            userId: alertNotifications.userId,
            message: alertNotifications.message,
            metric: alertNotifications.metric,
            symbol: alertNotifications.symbol,
            href: alertNotifications.href,
            triggeredAt: alertNotifications.triggeredAt,
            address: authUsers.email,
            token: emailPreferences.unsubscribeToken,
        })
        .from(alertNotifications)
        .innerJoin(emailPreferences, eq(emailPreferences.userId, alertNotifications.userId))
        .innerJoin(authUsers, eq(authUsers.id, alertNotifications.userId))
        .where(and(
            eq(emailPreferences.alerts, true),
            isNotNull(authUsers.email),
            eq(alertNotifications.cleared, false),
            isNull(alertNotifications.readAt),
            isNull(alertNotifications.emailedAt),
            claimable(alertNotifications.emailClaimedAt, now),
            gte(alertNotifications.triggeredAt, emailPreferences.alertsSince),
            gt(alertNotifications.triggeredAt, new Date(now.getTime() - ALERT_EMAIL_MAX_AGE_DAYS * DAY_MS)),
        ))
        .orderBy(asc(alertNotifications.userId), desc(alertNotifications.triggeredAt), asc(alertNotifications.id));
}

/** Claims alerts for an email: those no other run has claimed, sent or seen cleared. */
export function buildClaimAlertsQuery(ids: string[], now: Date, database: Database = db) {
    return database
        .update(alertNotifications)
        .set({ emailClaimedAt: now })
        .where(and(
            inArray(alertNotifications.id, ids),
            isNull(alertNotifications.emailedAt),
            eq(alertNotifications.cleared, false),
            claimable(alertNotifications.emailClaimedAt, now),
        ))
        .returning({ id: alertNotifications.id });
}

/** Marks this run's claimed alerts sent. */
export function buildAlertsSentQuery(ids: string[], claimedAt: Date, database: Database = db) {
    return database
        .update(alertNotifications)
        .set({ emailedAt: claimedAt, emailClaimedAt: null })
        .where(and(inArray(alertNotifications.id, ids), eq(alertNotifications.emailClaimedAt, claimedAt)));
}

/** Gives back a claim whose email didn't go. */
export function buildReleaseAlertsQuery(ids: string[], claimedAt: Date, database: Database = db) {
    return database
        .update(alertNotifications)
        .set({ emailClaimedAt: null })
        .where(and(inArray(alertNotifications.id, ids), eq(alertNotifications.emailClaimedAt, claimedAt)));
}

/** Who wants the review of `week`, hasn't had it, and isn't being sent it by another run. */
export function buildWeeklyReviewRecipientsQuery(week: string, now: Date, database: Database = db) {
    return database
        .select({ userId: emailPreferences.userId, address: authUsers.email, token: emailPreferences.unsubscribeToken })
        .from(emailPreferences)
        .innerJoin(authUsers, eq(authUsers.id, emailPreferences.userId))
        .where(and(
            eq(emailPreferences.weeklyReview, true),
            isNotNull(authUsers.email),
            sql`${emailPreferences.weeklyReviewWeek} is distinct from ${week}`,
            claimable(emailPreferences.weeklyReviewClaimedAt, now),
        ))
        .orderBy(asc(emailPreferences.userId));
}

/** Claims the user's review of `week`, if no other run has it or has sent it. */
export function buildClaimWeeklyReviewQuery(userId: string, week: string, now: Date, database: Database = db) {
    return database
        .update(emailPreferences)
        .set({ weeklyReviewClaimedAt: now })
        .where(and(
            eq(emailPreferences.userId, userId),
            eq(emailPreferences.weeklyReview, true),
            sql`${emailPreferences.weeklyReviewWeek} is distinct from ${week}`,
            claimable(emailPreferences.weeklyReviewClaimedAt, now),
        ))
        .returning({ userId: emailPreferences.userId });
}

/** Marks this run's claimed review handled: sent, or not needed for want of trades. */
export function buildWeeklyReviewDoneQuery(userId: string, week: string, claimedAt: Date, database: Database = db) {
    return database
        .update(emailPreferences)
        .set({ weeklyReviewWeek: week, weeklyReviewClaimedAt: null })
        .where(and(eq(emailPreferences.userId, userId), eq(emailPreferences.weeklyReviewClaimedAt, claimedAt)));
}

export function buildReleaseWeeklyReviewQuery(userId: string, claimedAt: Date, database: Database = db) {
    return database
        .update(emailPreferences)
        .set({ weeklyReviewClaimedAt: null })
        .where(and(eq(emailPreferences.userId, userId), eq(emailPreferences.weeklyReviewClaimedAt, claimedAt)));
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Sends spaced out and within the budget; counts what went and failed. */
class Outbox {
    sent = 0;
    failed = 0;
    firstError: string | null = null;
    private lastSendAt: number | null = null;
    private readonly startedAt: number;

    constructor(private readonly deps: Required<Pick<EmailJobDeps, "pause" | "clock" | "budgetMs">> & { send: SendEmail }) {
        this.startedAt = deps.clock();
    }

    /** Whether there's time to start another email within `limitMs` of the job's start (its whole budget by default). */
    hasTime(limitMs: number = this.deps.budgetMs): boolean {
        return this.deps.clock() - this.startedAt < Math.min(limitMs, this.deps.budgetMs);
    }

    /** True when the email went. */
    async send(email: OutgoingEmail): Promise<boolean> {
        if (this.lastSendAt !== null) {
            const wait = SEND_SPACING_MS - (this.deps.clock() - this.lastSendAt);
            if (wait > 0) await this.deps.pause(wait);
        }
        this.lastSendAt = this.deps.clock();
        try {
            await this.deps.send(email);
            this.sent += 1;
            return true;
        } catch (error) {
            this.fail(error);
            return false;
        }
    }

    fail(error: unknown): void {
        this.failed += 1;
        this.firstError ??= error instanceof Error ? error.message : String(error);
    }
}

function outgoing(to: string, rendered: RenderedEmail, headers: Record<string, string>, category: string, idempotencyKey: string): OutgoingEmail {
    return { to, ...rendered, headers, category, idempotencyKey };
}

/** The same key for the same email, however often it's retried. */
function keyFor(...parts: string[]): string {
    return createHash("sha256").update(parts.join("\n")).digest("hex");
}

type AlertRow = Awaited<ReturnType<typeof buildAlertsToEmailQuery>>[number];

/** Each user's alerts, newest first, the user whose oldest has waited longest first. */
export function alertsByUser(rows: readonly AlertRow[]): AlertRow[][] {
    const byUser = new Map<string, AlertRow[]>();
    for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    const oldest = (alerts: AlertRow[]) => Math.min(...alerts.map((alert) => alert.triggeredAt.getTime()));
    return [...byUser.values()]
        .map((alerts) => [...alerts].sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime() || a.id.localeCompare(b.id)))
        .sort((a, b) => oldest(a) - oldest(b) || a[0].userId.localeCompare(b[0].userId));
}

async function emailAlerts(
    outbox: Outbox,
    config: EmailConfig,
    now: Date,
    database: Database,
    limitMs: number,
): Promise<NonNullable<EmailJobDetail["alerts"]>> {
    const sentBefore = outbox.sent;
    const failedBefore = outbox.failed;
    let deferred = 0;
    for (const alerts of alertsByUser(await buildAlertsToEmailQuery(now, database))) {
        if (!outbox.hasTime(limitMs)) {
            deferred += 1;
            continue;
        }
        const claimed = new Set((await buildClaimAlertsQuery(alerts.map((a) => a.id), now, database)).map((row) => row.id));
        const mine = alerts.filter((alert) => claimed.has(alert.id));
        if (mine.length === 0) continue;
        const { userId, address, token } = mine[0];
        const links = { siteUrl: config.siteUrl, token };
        const rendered = alertsEmail(mine.map((alert) => ({ ...alert, metric: alert.metric as AlertMetric })), links);
        const ids = mine.map((alert) => alert.id).sort();
        const sent = await outbox.send(outgoing(
            address!,
            rendered,
            unsubscribeHeaders(unsubscribeUrls(links, "alerts")),
            "alerts",
            `alerts/${keyFor(userId, ...ids)}`,
        ));
        await (sent ? buildAlertsSentQuery(ids, now, database) : buildReleaseAlertsQuery(ids, now, database));
    }
    return { sent: outbox.sent - sentBefore, failed: outbox.failed - failedBefore, deferred };
}

type Recipient = Awaited<ReturnType<typeof buildWeeklyReviewRecipientsQuery>>[number];

async function emailWeeklyReviews(
    outbox: Outbox,
    config: EmailConfig,
    now: Date,
    week: ReturnType<typeof easternWeekBounds>,
    recipients: readonly Recipient[],
    database: Database,
    loadJournal: NonNullable<EmailJobDeps["loadJournal"]>,
): Promise<NonNullable<EmailJobDetail["weeklyReview"]>> {
    const sentBefore = outbox.sent;
    const failedBefore = outbox.failed;
    let noTrades = 0;
    let deferred = 0;
    for (const recipient of recipients) {
        if (!outbox.hasTime()) {
            deferred += 1;
            continue;
        }
        const [claimed] = await buildClaimWeeklyReviewQuery(recipient.userId, week.id, now, database);
        if (!claimed) continue;
        const release = () => buildReleaseWeeklyReviewQuery(recipient.userId, now, database);
        const done = () => buildWeeklyReviewDoneQuery(recipient.userId, week.id, now, database);

        let journal: TradeJournal;
        try {
            journal = await loadJournal(recipient.userId, now);
        } catch (error) {
            outbox.fail(error);
            await release();
            continue;
        }
        const review = generateReview(journal.entries, week, { nav: journal.netWorth });
        // Today shows no review for a week without closed trades; neither does email.
        if (review.stats.tradeCount.total === 0) {
            noTrades += 1;
            await done();
            continue;
        }
        const links = { siteUrl: config.siteUrl, token: recipient.token };
        const sent = await outbox.send(outgoing(
            recipient.address!,
            weeklyReviewEmail(review, journal.leftOut, links),
            unsubscribeHeaders(unsubscribeUrls(links, "weekly_review")),
            "weekly_review",
            `weekly-review/${keyFor(recipient.userId, week.id)}`,
        ));
        await (sent ? done() : release());
    }
    return { week: week.id, sent: outbox.sent - sentBefore, noTrades, failed: outbox.failed - failedBefore, deferred };
}

export class EmailJobError extends Error {
    constructor(readonly detail: EmailJobDetail, failed: number, firstError: string | null) {
        super(`${failed} ${failed === 1 ? "email" : "emails"} couldn't be sent and will go on a later run. First: ${firstError ?? "unknown"}`);
        this.name = "EmailJobError";
    }
}

export async function sendScheduledEmails({
    now = new Date(),
    database = db,
    env = process.env,
    send,
    loadJournal = (userId, at) => loadTradeJournal(userId, { now: at }),
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    clock = () => Date.now(),
    budgetMs = EMAIL_JOB_BUDGET_MS,
}: EmailJobDeps = {}): Promise<EmailJobDetail> {
    const setup = emailSetup(env);
    if (!setup.ok) return { skipped: setup.reason };

    const outbox = new Outbox({ send: send ?? resendSender(setup.config), pause, clock, budgetMs });
    const week = easternWeekBounds(now);
    const closedAt = Date.parse(week.weekEnd);
    const reviewsDue = now.getTime() >= closedAt && now.getTime() < closedAt + WEEKLY_REVIEW_SEND_DAYS * DAY_MS;
    const recipients = reviewsDue ? await buildWeeklyReviewRecipientsQuery(week.id, now, database) : [];

    // Reviews waiting get at least half the budget: alerts come every evening, a review's chance only until Tuesday.
    const alerts = await emailAlerts(outbox, setup.config, now, database, recipients.length > 0 ? budgetMs / 2 : budgetMs);
    const weeklyReview = reviewsDue
        ? await emailWeeklyReviews(outbox, setup.config, now, week, recipients, database, loadJournal)
        : { week: null };
    const detail: EmailJobDetail = { alerts, weeklyReview };
    if (outbox.failed > 0) throw new EmailJobError(detail, outbox.failed, outbox.firstError);
    return detail;
}
