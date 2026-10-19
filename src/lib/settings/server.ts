/**
 * Reading and writing the user_settings row (launch item i37). Every query is
 * scoped to one user's ID; the API route and the root layout get it from the
 * session.
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { isDatabaseConfigured } from "@/db/connection-options";
import { userSettings } from "@/db/schema";

import type { ServerSettingsSnapshot, SettingsDocument } from "./document";

type Database = typeof db;

export function buildLoadUserSettingsQuery(userId: string, database: Database = db) {
    return database
        .select({ version: userSettings.version, settings: userSettings.settings, updatedAt: userSettings.updatedAt })
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
}

export function buildSaveUserSettingsQuery(userId: string, document: SettingsDocument, now: Date, database: Database = db) {
    return database
        .insert(userSettings)
        .values({ userId, version: document.version, settings: document.settings, updatedAt: now })
        .onConflictDoUpdate({
            target: userSettings.userId,
            set: { version: document.version, settings: document.settings, updatedAt: now },
        })
        .returning({ updatedAt: userSettings.updatedAt });
}

export async function saveUserSettings(
    userId: string,
    document: SettingsDocument,
    { now = new Date(), database = db }: { now?: Date; database?: Database } = {},
): Promise<{ updatedAt: string }> {
    const [row] = await buildSaveUserSettingsQuery(userId, document, now, database);
    return { updatedAt: row.updatedAt.toISOString() };
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
        const [row] = await buildLoadUserSettingsQuery(userId, database);
        if (!row) return { status: "ok", document: null };
        return {
            status: "ok",
            document: {
                version: row.version,
                settings: row.settings as SettingsDocument["settings"],
                updatedAt: row.updatedAt.toISOString(),
            },
        };
    } catch (error) {
        console.warn("Settings unavailable: reading user_settings failed.", error);
        return { status: "unavailable" };
    }
}
