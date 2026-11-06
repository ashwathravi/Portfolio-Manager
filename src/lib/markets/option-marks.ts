/**
 * Option marks (launch item i63): the newest end-of-day close of each
 * contract anyone holds, which the nightly price job asks Massive for once
 * a session (./price-ingest.ts, step 4). Massive's free options plan has
 * end-of-day bars; a plan without options answers 403, and positions then
 * stay at the user's own price or the premium paid.
 */

import { and, asc, eq, gte, isNull, lt, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { optionMarks, optionPositions } from "@/db/schema";

type Database = typeof db;

/** Contracts a run asks about: within the free plan's 5 calls a minute, the price backfill keeps the rest. */
export const MAX_OPTION_MARKS_PER_RUN = 10;
/** How far back a close may be: an illiquid LEAPS can go weeks without a trade. */
export const OPTION_CLOSE_LOOKBACK_DAYS = 30;

/** The first day of the window a contract's newest close is looked for in, up to `session`. */
export function optionCloseWindowStart(session: string): string {
    const start = new Date(`${session}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - OPTION_CLOSE_LOOKBACK_DAYS);
    return start.toISOString().slice(0, 10);
}

/**
 * Held contracts not yet asked about for `session`, the never-asked first:
 * what a run fetches. Expired ones are left out; they trade no more.
 * Deliberately not scoped to a user: it returns contracts, never who holds them.
 */
export function buildOptionContractsToMarkQuery(session: string, database: Database = db) {
    return database
        .selectDistinct({ contract: optionPositions.contract, checkedAt: optionMarks.checkedAt })
        .from(optionPositions)
        .leftJoin(optionMarks, eq(optionMarks.contract, optionPositions.contract))
        .where(and(
            gte(optionPositions.expiry, session),
            or(isNull(optionMarks.contract), lt(optionMarks.checkedSession, session)),
        ))
        .orderBy(sql`${optionMarks.checkedAt} asc nulls first`, asc(optionPositions.contract));
}

export async function listOptionContractsToMark(limit: number, session: string, database: Database = db): Promise<string[]> {
    return (await buildOptionContractsToMarkQuery(session, database).limit(limit)).map((row) => row.contract);
}

export async function countOptionContractsToMark(session: string, database: Database = db): Promise<number> {
    return (await buildOptionContractsToMarkQuery(session, database)).length;
}

/**
 * Records that `contract` was asked about for `session`, with the close
 * found, if any. An older close than the one stored is not kept: the
 * stored one stays until a newer one arrives.
 */
export function buildSaveOptionMarkQuery(
    contract: string,
    found: { date: string; close: number } | null,
    { session, at, source }: { session: string; at: Date; source: string },
    database: Database = db,
) {
    const newer = found
        ? sql`${optionMarks.closeDate} is null or ${optionMarks.closeDate} <= ${found.date}`
        : sql`false`;
    return database
        .insert(optionMarks)
        .values({ contract, close: found?.close ?? null, closeDate: found?.date ?? null, checkedSession: session, checkedAt: at, source })
        .onConflictDoUpdate({
            target: optionMarks.contract,
            set: {
                close: sql`case when ${newer} then ${found?.close ?? null}::double precision else ${optionMarks.close} end`,
                closeDate: sql`case when ${newer} then ${found?.date ?? null}::date else ${optionMarks.closeDate} end`,
                checkedSession: session,
                checkedAt: at,
                source,
            },
        });
}

export async function saveOptionMark(
    contract: string,
    found: { date: string; close: number } | null,
    options: { session: string; at: Date; source: string },
    database: Database = db,
): Promise<void> {
    await buildSaveOptionMarkQuery(contract, found, options, database);
}

/** The marks of contracts no one holds any more. */
export function buildPruneOptionMarksQuery(database: Database = db) {
    const held = database.selectDistinct({ contract: optionPositions.contract }).from(optionPositions);
    return database.delete(optionMarks).where(notInArray(optionMarks.contract, held)).returning({ contract: optionMarks.contract });
}

/** Drops the marks of contracts no one holds any more; returns how many. */
export async function pruneOptionMarks(database: Database = db): Promise<number> {
    return (await buildPruneOptionMarksQuery(database)).length;
}
