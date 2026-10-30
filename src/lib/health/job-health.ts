/**
 * Whether the scheduled jobs run on time (launch item i71). Every job has a
 * schedule; a job is "ok" when it has succeeded since its most recent run
 * fell due, "failed" when that run failed (or was cut off), and "late" when
 * nothing has run since. /api/health/jobs reports this publicly in coarse
 * terms, never error text, so the production monitor
 * (.github/workflows/production-monitor.yml) or any uptime service can alert
 * when a job fails or stops running.
 *
 * The nightly jobs record their runs in job_runs (src/lib/jobs/runner.ts);
 * the nightly backup records one row per run from its workflow
 * (scripts/db/record-backup-run.ts).
 */

import { inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobRuns, type JobRunStatus } from "@/db/schema";

import type { DatabaseReadiness } from "./readiness";

type Database = typeof db;

export interface JobSchedule {
    /** job_runs.job */
    job: string;
    /**
     * When it runs, in UTC: "minute hour * * weekdays". Only the hour is
     * used. Vercel Hobby runs a cron job at any minute of its hour, and
     * GitHub starts scheduled workflows late under load.
     */
    cron: string;
    /** How long after its hour begins a run must have succeeded. */
    graceMinutes: number;
}

/** vercel.json's schedule for /api/cron/daily (a test keeps them equal). */
export const DAILY_JOBS_CRON = "30 22 * * 1-5";
/** .github/workflows/database-backup.yml's schedule (a test keeps them equal). */
export const BACKUP_CRON = "41 6 * * *";
/** The job name the backup workflow records its runs under. */
export const BACKUP_JOB = "backup";
/** The names in src/lib/jobs/daily-jobs.ts, in order (a test keeps them equal). */
export const DAILY_JOB_NAMES = ["expired-sessions", "ask-history", "plaid", "prices", "snapshots"] as const;

export const JOB_SCHEDULES: readonly JobSchedule[] = [
    // The run takes at most five minutes (the route's maxDuration).
    ...DAILY_JOB_NAMES.map((job) => ({ job, cron: DAILY_JOBS_CRON, graceMinutes: 120 })),
    // About ten minutes, after a start GitHub may delay.
    { job: BACKUP_JOB, cron: BACKUP_CRON, graceMinutes: 240 },
];

/** A "running" row older than this was cut off (the route stops at five minutes). */
export const STUCK_AFTER_MS = 15 * 60_000;

export type JobHealthStatus = "ok" | "late" | "failed";

export interface JobHealth {
    job: string;
    status: JobHealthStatus;
    /** When its last successful run started, or null if none has. */
    lastSucceededAt: string | null;
    /** The start of the hour its most recent due run belongs to. */
    dueSince: string;
}

export interface JobHealthReport {
    status: "ok" | "degraded";
    database: DatabaseReadiness;
    jobs: JobHealth[];
    checkedAt: string;
}

/** One job's runs, summarised by {@link buildJobHealthQuery}. */
export interface JobRunSummary {
    job: string;
    lastSucceededAt: Date | null;
    latestStartedAt: Date | null;
    latestStatus: JobRunStatus | null;
}

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** The hour and weekdays (0 = Sunday) of a "minute hour * * weekdays" cron line. */
export function parseDailyCron(cron: string): { hour: number; days: ReadonlySet<number> } {
    const fields = cron.trim().split(/\s+/);
    const [minute, hour, dayOfMonth, month, weekdays] = fields;
    if (
        fields.length !== 5
        || !/^\d{1,2}$/.test(minute) || Number(minute) > 59
        || !/^\d{1,2}$/.test(hour) || Number(hour) > 23
        || dayOfMonth !== "*" || month !== "*"
    ) {
        throw new Error(`Unsupported schedule "${cron}": expected "minute hour * * weekdays".`);
    }

    const days = new Set<number>();
    for (const part of weekdays === "*" ? ["0-6"] : weekdays.split(",")) {
        const range = /^([0-6])(?:-([0-6]))?$/.exec(part);
        if (!range) throw new Error(`Unsupported weekdays "${weekdays}" in "${cron}".`);
        const from = Number(range[1]);
        const to = range[2] === undefined ? from : Number(range[2]);
        if (to < from) throw new Error(`Unsupported weekdays "${weekdays}" in "${cron}".`);
        for (let day = from; day <= to; day += 1) days.add(day);
    }
    return { hour: Number(hour), days };
}

/** The start of the scheduled hour of the most recent run whose grace has passed. */
export function lastDueSlot(schedule: JobSchedule, now: Date): Date {
    const { hour, days } = parseDailyCron(schedule.cron);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour);
    // Every weekday set has a slot within the last week; one more day covers
    // today's slot not being due yet.
    for (let back = 0; back <= 7; back += 1) {
        const slot = new Date(today - back * DAY_MS);
        if (days.has(slot.getUTCDay()) && slot.getTime() + schedule.graceMinutes * 60_000 <= now.getTime()) {
            return slot;
        }
    }
    throw new Error(`No run of "${schedule.cron}" falls due in a week.`);
}

export function assessJob(schedule: JobSchedule, summary: JobRunSummary | undefined, now: Date): JobHealth {
    const due = lastDueSlot(schedule, now);
    const lastSucceededAt = summary?.lastSucceededAt ?? null;
    const latestStartedAt = summary?.latestStartedAt ?? null;

    let status: JobHealthStatus = "late";
    if (lastSucceededAt && lastSucceededAt >= due) {
        status = "ok";
    } else if (latestStartedAt && latestStartedAt >= due) {
        const cutOff = summary?.latestStatus === "running"
            && now.getTime() - latestStartedAt.getTime() > STUCK_AFTER_MS;
        if (summary?.latestStatus === "failed" || cutOff) status = "failed";
    }

    return {
        job: schedule.job,
        status,
        lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
        dueSince: due.toISOString(),
    };
}

/** Each scheduled job's last success and latest run, in one small query. */
export function buildJobHealthQuery(jobs: readonly string[], database: Pick<Database, "select"> = db) {
    return database
        .select({
            job: jobRuns.job,
            lastSucceededAt: sql<Date | null>`max(${jobRuns.startedAt}) filter (where ${jobRuns.status} = 'succeeded')`
                .mapWith(jobRuns.startedAt),
            latestStartedAt: sql<Date | null>`max(${jobRuns.startedAt})`.mapWith(jobRuns.startedAt),
            latestStatus: sql<JobRunStatus | null>`(array_agg(${jobRuns.status} order by ${jobRuns.startedAt} desc))[1]`,
        })
        .from(jobRuns)
        .where(inArray(jobRuns.job, [...jobs]))
        .groupBy(jobRuns.job);
}

export interface JobHealthCheckOptions {
    /** Whether a database connection is configured at all. */
    isConfigured: () => boolean;
    /** The summaries for these jobs; a job that never ran has none. */
    load: (jobs: readonly string[]) => Promise<readonly JobRunSummary[]>;
    schedules?: readonly JobSchedule[];
    /** How long a load may take before the database counts as unavailable. */
    timeoutMs?: number;
    /** How long a report is reused, so a public endpoint can't hammer the database. */
    cacheMs?: number;
    /** How long a report without the database is reused, so it recovers quickly. */
    unavailableCacheMs?: number;
    now?: () => number;
}

/**
 * The check behind /api/health/jobs. Reports are cached and concurrent
 * callers share one load. A failed load reports the database as unavailable,
 * never the error, and so does every check while a load that outlived its
 * timeout is still outstanding: it may hold a pooled connection, and a
 * public endpoint mustn't fill the pool during an outage.
 */
export function createJobHealthCheck({
    isConfigured,
    load,
    schedules = JOB_SCHEDULES,
    timeoutMs = 5_000,
    cacheMs = 60_000,
    unavailableCacheMs = 10_000,
    now = Date.now,
}: JobHealthCheckOptions): () => Promise<JobHealthReport> {
    let cached: { report: JobHealthReport; expiresAt: number } | null = null;
    let inFlight: Promise<JobHealthReport> | null = null;
    let outstandingLoad: Promise<unknown> | null = null;

    async function loadOnce(): Promise<readonly JobRunSummary[] | null> {
        if (outstandingLoad) return null;
        const attempt = load(schedules.map((schedule) => schedule.job));
        outstandingLoad = attempt;
        attempt.then(settle, settle);
        function settle() {
            if (outstandingLoad === attempt) outstandingLoad = null;
        }
        return withTimeout(attempt, timeoutMs);
    }

    async function check(): Promise<JobHealthReport> {
        const checkedAt = new Date(now());
        const degraded = (database: DatabaseReadiness): JobHealthReport => ({
            status: "degraded",
            database,
            jobs: [],
            checkedAt: checkedAt.toISOString(),
        });
        if (!isConfigured()) return degraded("not_configured");

        const summaries = await loadOnce();
        if (!summaries) return degraded("unavailable");

        const byJob = new Map(summaries.map((summary) => [summary.job, summary]));
        const jobs = schedules.map((schedule) => assessJob(schedule, byJob.get(schedule.job), checkedAt));
        return {
            status: jobs.every((job) => job.status === "ok") ? "ok" : "degraded",
            database: "ok",
            jobs,
            checkedAt: checkedAt.toISOString(),
        };
    }

    return async () => {
        if (cached && now() < cached.expiresAt) return cached.report;
        if (inFlight) return inFlight;

        inFlight = check()
            .then((report) => {
                const ttl = report.database === "unavailable" ? unavailableCacheMs : cacheMs;
                cached = { report, expiresAt: now() + ttl };
                return report;
            })
            .finally(() => {
                inFlight = null;
            });
        return inFlight;
    };
}

/** The load's result, or null when it fails or takes longer than `timeoutMs`. */
async function withTimeout<T>(attempt: Promise<T>, timeoutMs: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
        return await Promise.race([attempt.catch(() => null), timeout]);
    } finally {
        clearTimeout(timer);
    }
}
