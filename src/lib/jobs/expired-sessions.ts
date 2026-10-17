/**
 * Daily job "expired-sessions": deletes Auth.js database sessions whose
 * expiry has passed. Auth.js removes an expired session only when its cookie
 * comes back, so sessions from browsers that never return pile up.
 */

import { lt } from "drizzle-orm";

import { db } from "@/db";
import { authSessions } from "@/db/schema";

type Database = typeof db;

export function buildDeleteExpiredSessionsQuery(now: Date, database: Database = db) {
    // The cutoff is bound from the app clock, the same clock Auth.js used to
    // write `expires`, so the server's time zone doesn't matter.
    return database.delete(authSessions).where(lt(authSessions.expires, now));
}

export async function deleteExpiredSessions({
    now = new Date(),
    database = db,
}: { now?: Date; database?: Database } = {}): Promise<{ deleted: number }> {
    const result = await buildDeleteExpiredSessionsQuery(now, database);
    return { deleted: result.count };
}
