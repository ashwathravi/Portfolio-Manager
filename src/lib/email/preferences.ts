/**
 * The email_preferences table (launch item i58): which emails the user
 * asked for, and the token their unsubscribe links carry. Settings reads
 * and changes it for the signed-in user; an unsubscribe link turns one
 * email off by its token alone, without a session.
 */

import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { authUsers, emailPreferences } from "@/db/schema";
import type { EmailList, EmailPreferencesInput } from "@/lib/validators/email";

type Database = typeof db;

export interface EmailPreferences {
    alerts: boolean;
    weeklyReview: boolean;
    /** Where they go: the address of the Google account the user signs in with. */
    address: string | null;
}

/** 32 random bytes, base64url (43 characters). */
export function newUnsubscribeToken(): string {
    return randomBytes(32).toString("base64url");
}

export function buildLoadEmailPreferencesQuery(userId: string, database: Database = db) {
    return database
        .select({ address: authUsers.email, alerts: emailPreferences.alerts, weeklyReview: emailPreferences.weeklyReview })
        .from(authUsers)
        .leftJoin(emailPreferences, eq(emailPreferences.userId, authUsers.id))
        .where(eq(authUsers.id, userId))
        .limit(1);
}

/** The user's choices; both off before they make any. */
export async function loadEmailPreferences(userId: string, database: Database = db): Promise<EmailPreferences> {
    const [row] = await buildLoadEmailPreferencesQuery(userId, database);
    return { alerts: row?.alerts ?? false, weeklyReview: row?.weeklyReview ?? false, address: row?.address ?? null };
}

/**
 * Sets the switches given and leaves the other. The first save makes the
 * row and its token. Turning alert emails on starts them from `now`, so
 * the alerts already in the bell aren't emailed.
 */
export function buildSaveEmailPreferencesQuery(
    userId: string,
    input: EmailPreferencesInput,
    now: Date,
    token: string,
    database: Database = db,
) {
    return database
        .insert(emailPreferences)
        .values({
            userId,
            alerts: input.alerts ?? false,
            weeklyReview: input.weeklyReview ?? false,
            alertsSince: input.alerts ? now : null,
            unsubscribeToken: token,
            updatedAt: now,
        })
        .onConflictDoUpdate({
            target: emailPreferences.userId,
            set: {
                ...(input.alerts === undefined ? {} : { alerts: input.alerts }),
                ...(input.alerts ? {
                    alertsSince: sql`case when ${emailPreferences.alerts} then ${emailPreferences.alertsSince} else ${now.toISOString()}::timestamp end`,
                } : {}),
                ...(input.weeklyReview === undefined ? {} : { weeklyReview: input.weeklyReview }),
                updatedAt: now,
            },
        })
        .returning({ alerts: emailPreferences.alerts, weeklyReview: emailPreferences.weeklyReview });
}

export async function saveEmailPreferences(
    userId: string,
    input: EmailPreferencesInput,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<Omit<EmailPreferences, "address">> {
    const [row] = await buildSaveEmailPreferencesQuery(userId, input, now, newUnsubscribeToken(), database);
    return row;
}

export function buildUnsubscribeQuery(token: string, list: EmailList, now: Date, database: Database = db) {
    return database
        .update(emailPreferences)
        .set(list === "alerts" ? { alerts: false, updatedAt: now } : { weeklyReview: false, updatedAt: now })
        .where(eq(emailPreferences.unsubscribeToken, token))
        .returning({ userId: emailPreferences.userId });
}

/** Turns one email off for whoever the token belongs to; false when it belongs to nobody. */
export async function unsubscribe(
    token: string,
    list: EmailList,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<boolean> {
    const rows = await buildUnsubscribeQuery(token, list, now, database);
    return rows.length > 0;
}
