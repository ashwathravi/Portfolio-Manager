/**
 * The filers each user follows in Alpha Radar (launch item i60). Tracked
 * filers are shared and only admins add or change them; following one is
 * the user's own choice, kept with the account. Every query is scoped to the
 * user ID the API routes take from the session.
 */

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { alphaRadarFilerFollows, alphaRadarTrackedFilers } from "@/db/schema";

type Database = typeof db;

export function buildListFollowedFilersQuery(userId: string, database: Pick<Database, "select"> = db) {
    return database
        .select({
            trackedFilerId: alphaRadarFilerFollows.trackedFilerId,
            name: alphaRadarTrackedFilers.name,
            followedAt: alphaRadarFilerFollows.createdAt,
        })
        .from(alphaRadarFilerFollows)
        .innerJoin(alphaRadarTrackedFilers, eq(alphaRadarTrackedFilers.id, alphaRadarFilerFollows.trackedFilerId))
        .where(eq(alphaRadarFilerFollows.userId, userId))
        .orderBy(asc(alphaRadarTrackedFilers.name), asc(alphaRadarFilerFollows.trackedFilerId));
}

/** Whether any filer is tracked, so there is something to follow. */
export async function hasTrackedFilers(database: Pick<Database, "select"> = db): Promise<boolean> {
    const [row] = await database.select({ id: alphaRadarTrackedFilers.id }).from(alphaRadarTrackedFilers).limit(1);
    return Boolean(row);
}

/** The IDs of the filers the user follows, by filer name. */
export async function listFollowedFilerIds(userId: string, database: Database = db): Promise<string[]> {
    const rows = await buildListFollowedFilersQuery(userId, database);
    return rows.map((row) => row.trackedFilerId);
}

/**
 * Follows a tracked filer. Following one already followed changes nothing.
 * False when there is no such filer.
 */
export async function followFiler(userId: string, trackedFilerId: string, database: Database = db): Promise<boolean> {
    const [filer] = await database
        .select({ id: alphaRadarTrackedFilers.id })
        .from(alphaRadarTrackedFilers)
        .where(eq(alphaRadarTrackedFilers.id, trackedFilerId));
    if (!filer) return false;
    await database
        .insert(alphaRadarFilerFollows)
        .values({ userId, trackedFilerId })
        .onConflictDoNothing();
    return true;
}

/** Stops following a filer; nothing happens if the user didn't follow it. */
export async function unfollowFiler(userId: string, trackedFilerId: string, database: Database = db): Promise<void> {
    await database
        .delete(alphaRadarFilerFollows)
        .where(and(eq(alphaRadarFilerFollows.userId, userId), eq(alphaRadarFilerFollows.trackedFilerId, trackedFilerId)));
}
