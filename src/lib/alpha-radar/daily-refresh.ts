/**
 * The daily SEC job (launch item i60). /api/cron/alpha-radar runs it once a
 * day: it asks SEC for every enabled tracked filer's recent 13F filings, and
 * parses and writes a report for each new one. Only admins add filers, so
 * the list stays short, and the SEC client keeps to SEC's request rate.
 *
 * The filers checked longest ago go first, and none is started once the
 * budget is spent: the rest go first tomorrow. SEC requests stop at a
 * later deadline, so a slow filer can't run past the route's limit before
 * the run is recorded. Every filer is checked, not
 * only the ones someone follows, so a filer has its filings by the time a
 * user looks at it. Without SEC_EDGAR_USER_AGENT nothing is asked and the
 * run fails, and so does a run in which every filer failed (SEC refusing
 * Atlas, say), so job health reports it.
 */

import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { alphaRadarTrackedFilers } from "@/db/schema";
import type { JobDetail, ScheduledJob } from "@/lib/jobs/runner";
import { configuredSecUserAgent, SEC_USER_AGENT_MISSING, SecEdgarError } from "@/lib/sec";

import type { AlphaRadarRefreshRunResult } from "./refresh";
import { getAlphaRadarRefreshService } from "./service-factory";

type Database = typeof db;

/** The cron route stops at 300 s; the last filer started has the rest. */
export const ALPHA_RADAR_JOB_BUDGET_MS = 240_000;

/** When SEC requests stop, leaving time to mark the filer and record the run. */
export const ALPHA_RADAR_JOB_STOP_MS = 270_000;

/** The name its runs are recorded under in job_runs. */
export const ALPHA_RADAR_JOB = "alpha-radar";

export function buildFilersToRefreshQuery(database: Database = db) {
    return database
        .select({ id: alphaRadarTrackedFilers.id, name: alphaRadarTrackedFilers.name })
        .from(alphaRadarTrackedFilers)
        .where(eq(alphaRadarTrackedFilers.enabled, true))
        .orderBy(sql`${alphaRadarTrackedFilers.lastRefreshedAt} asc nulls first`, asc(alphaRadarTrackedFilers.name));
}

export function buildMarkRefreshedQuery(id: string, at: Date, database: Database = db) {
    return database
        .update(alphaRadarTrackedFilers)
        .set({ lastRefreshedAt: at })
        .where(eq(alphaRadarTrackedFilers.id, id));
}

export interface DailyRefreshDeps {
    userAgent?: () => string | null;
    /** Enabled filers, the one checked longest ago first. */
    listFilers?: () => Promise<Array<{ id: string; name: string }>>;
    /** `stop` aborts at the run's deadline; SEC requests end with it. */
    refreshFiler?: (id: string, stop: AbortSignal) => Promise<AlphaRadarRefreshRunResult>;
    markRefreshed?: (id: string, at: Date) => Promise<void>;
    budgetMs?: number;
    stopAfterMs?: number;
    clock?: () => number;
}

export async function refreshTrackedFilersDaily({
    userAgent = configuredSecUserAgent,
    listFilers = () => buildFilersToRefreshQuery(),
    refreshFiler,
    markRefreshed = async (id, at) => { await buildMarkRefreshedQuery(id, at); },
    budgetMs = ALPHA_RADAR_JOB_BUDGET_MS,
    stopAfterMs = ALPHA_RADAR_JOB_STOP_MS,
    clock = () => Date.now(),
}: DailyRefreshDeps = {}): Promise<JobDetail> {
    if (!userAgent()) throw new SecEdgarError("configuration", SEC_USER_AGENT_MISSING);
    const refresh = refreshFiler
        ?? ((id: string, signal: AbortSignal) => getAlphaRadarRefreshService({ signal }).refreshFiler(id));

    const stop = AbortSignal.timeout(stopAfterMs);
    const deadline = clock() + budgetMs;
    const filers = await listFilers();
    const failed: Array<{ filer: string; error: string }> = [];
    let checked = 0;
    let newFilings = 0;
    let reports = 0;
    for (const filer of filers) {
        if (clock() >= deadline || stop.aborted) break;
        checked++;
        try {
            const result = await refresh(filer.id, stop);
            newFilings += result.parsed;
            reports += result.memoGenerated;
            if (result.errors.length > 0) failed.push({ filer: filer.name, error: shorten(result.errors[0].message) });
        } catch (error) {
            failed.push({ filer: filer.name, error: shorten(error instanceof Error ? error.message : String(error)) });
        }
        // Tried, whatever the outcome: a filer that keeps failing goes to
        // the back instead of taking every day's first turn.
        await markRefreshed(filer.id, new Date(clock()));
    }

    if (checked > 0 && failed.length === checked) {
        throw new Error(`Every filer checked failed; the first: ${failed[0].filer}: ${failed[0].error}`);
    }
    return { filers: filers.length, checked, remaining: filers.length - checked, newFilings, reports, failed };
}

/** The detail is stored with the run; one long message mustn't swamp it. */
function shorten(message: string): string {
    return message.length > 200 ? `${message.slice(0, 199)}…` : message;
}

/** What /api/cron/alpha-radar runs. */
export const ALPHA_RADAR_JOBS: readonly ScheduledJob[] = [
    { name: ALPHA_RADAR_JOB, run: () => refreshTrackedFilersDaily() },
];
