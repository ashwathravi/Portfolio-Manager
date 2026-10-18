/**
 * Scheduled jobs (launch item i48): a run log in Postgres and a runner that
 * records each run.
 *
 * {@link runJob} inserts a "running" row, runs the job, then finishes the row
 * as "succeeded" with the detail the job returned or "failed" with a short
 * error message, and reports a failure to Sentry. It never throws, so a
 * caller running several jobs in a row keeps going when one fails. The cron
 * route (`/api/cron/daily`) is the only caller in production; the jobs it
 * runs are listed in `./daily-jobs`.
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { jobRuns, type JobRunStatus } from "@/db/schema";
import { reportError } from "@/lib/observability/report-error";
import { redactSecrets } from "@/lib/security/redact-secrets";

type Database = typeof db;

/** What a job reports about its run. Stored as JSON, so plain data only. */
export type JobDetail = Record<string, unknown>;

export interface ScheduledJob {
    /** Stable name, stored in job_runs.job, e.g. "prices". */
    name: string;
    run: () => Promise<JobDetail>;
}

export interface JobOutcome {
    job: string;
    status: Exclude<JobRunStatus, "running">;
    /** The job_runs row, or null when the run couldn't be recorded. */
    runId: string | null;
    startedAt: string;
    durationMs: number;
    detail?: JobDetail;
    error?: string;
}

/** Where runs are recorded. Postgres in production; a fake in tests. */
export interface JobRunStore {
    start(job: string, startedAt: Date): Promise<string>;
    finish(id: string, result: {
        status: Exclude<JobRunStatus, "running">;
        finishedAt: Date;
        detail: JobDetail | null;
        error: string | null;
    }): Promise<void>;
}

export interface RunJobDeps {
    store?: JobRunStore;
    now?: () => Date;
}

const MAX_ERROR_LENGTH = 300;

// ---------------------------------------------------------------------------
// Query builders (compiled in tests; executed by the store below)
// ---------------------------------------------------------------------------

export function buildStartJobRunQuery(job: string, startedAt: Date, database: Database = db) {
    return database
        .insert(jobRuns)
        .values({ job, startedAt, status: "running" })
        .returning({ id: jobRuns.id });
}

export function buildFinishJobRunQuery(
    id: string,
    result: Parameters<JobRunStore["finish"]>[1],
    database: Database = db,
) {
    return database
        .update(jobRuns)
        .set({
            status: result.status,
            finishedAt: result.finishedAt,
            detail: result.detail,
            error: result.error,
        })
        .where(eq(jobRuns.id, id));
}

/** The job_runs table as a {@link JobRunStore}. */
export function createJobRunStore(database: Database = db): JobRunStore {
    return {
        async start(job, startedAt) {
            const [row] = await buildStartJobRunQuery(job, startedAt, database);
            return row.id;
        },
        async finish(id, result) {
            await buildFinishJobRunQuery(id, result, database);
        },
    };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Runs one job and records it. The outcome says how it went; a failure is
 * reported, never thrown. When the start can't be recorded (the database is
 * down) the job is not run: every job needs the database, and a run that
 * leaves no trace can't be checked afterwards.
 */
export async function runJob(
    name: string,
    fn: () => Promise<JobDetail>,
    { store = createJobRunStore(), now = () => new Date() }: RunJobDeps = {},
): Promise<JobOutcome> {
    const startedAt = now();
    const outcome = (status: JobOutcome["status"], runId: string | null, fields: Partial<JobOutcome>): JobOutcome => ({
        job: name,
        status,
        runId,
        startedAt: startedAt.toISOString(),
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        ...fields,
    });

    let runId: string;
    try {
        runId = await store.start(name, startedAt);
    } catch (error) {
        reportError(error, { tags: { job: name } });
        return outcome("failed", null, { error: `Could not record the run: ${summarizeError(error)}` });
    }

    let result: JobOutcome;
    try {
        result = outcome("succeeded", runId, { detail: await fn() });
    } catch (error) {
        reportError(error, { tags: { job: name } });
        result = outcome("failed", runId, { error: summarizeError(error) });
    }

    try {
        await store.finish(runId, {
            status: result.status,
            finishedAt: now(),
            detail: result.detail ?? null,
            error: result.error ?? null,
        });
    } catch (error) {
        // The row stays "running"; the outcome still reports what the job did.
        console.error(`Could not record the end of job run ${runId} (${name}): ${summarizeError(error)}`);
    }
    return result;
}

/**
 * Runs jobs one after another. Each is isolated: one that fails is recorded
 * and the next still runs.
 */
export async function runJobs(jobs: readonly ScheduledJob[], deps: RunJobDeps = {}): Promise<JobOutcome[]> {
    const outcomes: JobOutcome[] = [];
    for (const job of jobs) outcomes.push(await runJob(job.name, job.run, deps));
    return outcomes;
}

/**
 * A one-line error message that is safe to store and return: secret values
 * from the environment, URL credentials and `apiKey=` parameters are masked,
 * and it is cut to {@link MAX_ERROR_LENGTH} characters.
 */
export function summarizeError(error: unknown, env: Partial<Record<string, string>> = process.env): string {
    const raw = error instanceof Error ? error.message || error.name : String(error);
    const message = redactSecrets(raw.split("\n")[0].trim() || "Unknown error", env);

    return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}
