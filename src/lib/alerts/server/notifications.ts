/**
 * The alert_notifications table (launch item i57): what the user's rules
 * found, newest first. Every query is scoped to one user's ID, which the API
 * routes take from the session. The nightly job writes the rows
 * (src/lib/alerts/nightly.ts); the user reads, marks read and clears them.
 */

import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { alertNotifications } from "@/db/schema";

import { isAlphaRadarAlertMetric } from "../metrics";
import type { AlertTrigger } from "../types";

type Database = typeof db;

/** How many the feed shows. */
export const ALERT_FEED_LIMIT = 50;

export interface AlertFeed {
    notifications: AlertTrigger[];
    /** Unread, the ones past the feed's limit included. */
    unread: number;
}

function toTrigger(row: typeof alertNotifications.$inferSelect): AlertTrigger {
    const metric = row.metric as AlertTrigger["metric"];
    return {
        id: row.id,
        ruleId: row.ruleId,
        ruleName: row.ruleName,
        metric,
        ...(row.symbol ? { symbol: row.symbol } : {}),
        comparator: row.comparator as AlertTrigger["comparator"],
        threshold: row.threshold,
        observedValue: row.observedValue,
        triggeredAt: row.triggeredAt.toISOString(),
        acknowledged: row.readAt !== null,
        source: isAlphaRadarAlertMetric(metric) ? "alpha_radar" : "market",
        message: row.message,
        ...(row.href ? { href: row.href } : {}),
    };
}

export function buildAlertFeedQuery(userId: string, limit: number = ALERT_FEED_LIMIT, database: Database = db) {
    return database
        .select()
        .from(alertNotifications)
        .where(eq(alertNotifications.userId, userId))
        .orderBy(desc(alertNotifications.triggeredAt), desc(alertNotifications.id))
        .limit(limit);
}

export async function loadAlertFeed(userId: string, database: Database = db): Promise<AlertFeed> {
    const [rows, [{ value: unread }]] = await Promise.all([
        buildAlertFeedQuery(userId, ALERT_FEED_LIMIT, database),
        database.select({ value: count() }).from(alertNotifications)
            .where(and(eq(alertNotifications.userId, userId), isNull(alertNotifications.readAt))),
    ]);
    return { notifications: rows.map(toTrigger), unread };
}

/** Marks the user's notifications read: the ones named, or all of them. Others' IDs are ignored. */
export async function markAlertNotificationsRead(
    userId: string,
    which: { ids: readonly string[] } | { all: true },
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<void> {
    await database
        .update(alertNotifications)
        .set({ readAt: now })
        .where(and(
            eq(alertNotifications.userId, userId),
            isNull(alertNotifications.readAt),
            "ids" in which ? inArray(alertNotifications.id, [...which.ids]) : undefined,
        ));
}

/** Deletes every notification the user has; their rules stay. */
export async function clearAlertNotifications(userId: string, database: Database = db): Promise<void> {
    await database.delete(alertNotifications).where(eq(alertNotifications.userId, userId));
}
