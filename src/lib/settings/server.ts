/**
 * Reading and writing the user_settings row (launch item i37). Every query is
 * scoped to one user's ID; the API route and the root layout get it from the
 * session.
 */

import { and, eq, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { isDatabaseConfigured } from "@/db/connection-options";
import { userSettings } from "@/db/schema";

import type { ServerSettingsSnapshot, SettingsDocument, StoredSettingsDocument } from "./document";

type Database = typeof db;

export function buildLoadUserSettingsQuery(userId: string, database: Database = db) {
    return database
        .select({ version: userSettings.version, settings: userSettings.settings, updatedAt: userSettings.updatedAt })
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
}

/**
 * Saves `document` only if it was made on the stored version: the row's
 * `updated_at` must still be `baseUpdatedAt`, or, with no base, there must
 * be no row yet. Nor does it replace a document from a newer version of the
 * app (after a rollback) with an older shape. Returns no row when a check
 * fails.
 */
export function buildSaveUserSettingsQuery(
    userId: string,
    document: SettingsDocument,
    baseUpdatedAt: string | null,
    now: Date,
    database: Database = db,
) {
    return database
        .insert(userSettings)
        .values({ userId, version: document.version, settings: document.settings, updatedAt: now })
        .onConflictDoUpdate({
            target: userSettings.userId,
            set: { version: document.version, settings: document.settings, updatedAt: now },
            setWhere: baseUpdatedAt === null
                ? sql`false`
                : and(eq(userSettings.updatedAt, new Date(baseUpdatedAt)), lte(userSettings.version, document.version)),
        })
        .returning({ updatedAt: userSettings.updatedAt });
}

export async function loadUserSettings(userId: string, database: Database = db): Promise<StoredSettingsDocument | null> {
    const [row] = await buildLoadUserSettingsQuery(userId, database);
    if (!row) return null;
    return {
        version: row.version,
        settings: row.settings as SettingsDocument["settings"],
        updatedAt: row.updatedAt.toISOString(),
    };
}

export type SaveSettingsResult =
    | { status: "saved"; updatedAt: string }
    /** Someone saved since `baseUpdatedAt`; `current` is what's stored now. */
    | { status: "conflict"; current: StoredSettingsDocument | null };

export async function saveUserSettings(
    userId: string,
    document: SettingsDocument,
    baseUpdatedAt: string | null,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<SaveSettingsResult> {
    const [row] = await buildSaveUserSettingsQuery(userId, document, baseUpdatedAt, now, database);
    if (row) return { status: "saved", updatedAt: row.updatedAt.toISOString() };
    return { status: "conflict", current: await loadUserSettings(userId, database) };
}

/**
 * What the root layout hands the browser: the user's stored document (or
 * null when they have none yet), or "unavailable" without a usable database
 * or when reading it fails, so a page still renders during an outage.
 */
export async function serverSettingsFor(
    userId: string | null | undefined,
    { database = db, env = process.env }: { database?: Database; env?: Record<string, string | undefined> } = {},
): Promise<ServerSettingsSnapshot> {
    if (!userId || !isDatabaseConfigured(env)) return { status: "unavailable" };
    try {
        return { status: "ok", document: await loadUserSettings(userId, database) };
    } catch (error) {
        console.warn("Settings unavailable: reading user_settings failed.", error);
        return { status: "unavailable" };
    }
}
