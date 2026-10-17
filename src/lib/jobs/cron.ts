/**
 * Cron endpoints (launch item i48). Vercel Cron calls the path with GET and
 * `Authorization: Bearer <CRON_SECRET>`. The proxy lets /api/cron/* through
 * without a session, so the check here is the only gate: every cron route
 * must be built with {@link createCronHandler}.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { usableDatabaseUrl } from "@/db/connection-options";
import { apiError, logApiEvent } from "@/lib/api/security";

import { runJobs, type RunJobDeps, type ScheduledJob } from "./runner";

type Database = typeof db;

export type CronAuthorization = { ok: true } | { ok: false; response: NextResponse };

/**
 * Fails closed: without a configured secret nothing runs (503), and a
 * missing or wrong token is refused (401).
 */
export function authorizeCronRequest(request: Request, secret: string | undefined): CronAuthorization {
    const expected = secret?.trim();
    if (!expected) {
        return { ok: false, response: apiError("Scheduled jobs are not configured.", "CRON_NOT_CONFIGURED", 503) };
    }
    const header = request.headers.get("authorization") ?? "";
    if (!secretsMatch(header, `Bearer ${expected}`)) {
        return { ok: false, response: apiError("Unauthorized", "UNAUTHORIZED", 401) };
    }
    return { ok: true };
}

/**
 * Constant-time comparison. Both sides are hashed first so they have the
 * same length, which timingSafeEqual requires; comparing the raw strings
 * would also reveal the secret's length.
 */
export function secretsMatch(given: string, expected: string): boolean {
    const digest = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(digest(given), digest(expected));
}

/** Runs `run` only if no other run holds `key`, across every instance. */
export interface RunLock {
    exclusive<T>(key: string, run: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>;
}

/** Takes the advisory lock for the rest of the transaction, or answers false at once. */
export function buildTryRunLockQuery(key: string) {
    return sql`select pg_try_advisory_xact_lock(hashtext(${key})) as locked`;
}

/**
 * A Postgres advisory lock held by a transaction that stays open, on its own
 * pooled connection, while the run uses others. Transaction-scoped, so it
 * works through a transaction pooler and is released if the connection
 * dies. Once the run has finished, a failure releasing the lock is logged,
 * not reported as the run's failure.
 */
export function createPostgresRunLock(database: Database = db): RunLock {
    return {
        async exclusive<T>(key: string, run: () => Promise<T>) {
            let outcome: { ran: true; value: T } | { ran: false } | undefined;
            try {
                await database.transaction(async (tx) => {
                    const rows = (await tx.execute(buildTryRunLockQuery(key))) as unknown as Array<{ locked: boolean }>;
                    if (!rows[0]?.locked) {
                        outcome = { ran: false };
                        return;
                    }
                    outcome = { ran: true, value: await run() };
                });
            } catch (error) {
                if (outcome?.ran) {
                    console.warn(`Releasing the run lock "${key}" failed after the run finished.`, error);
                    return outcome;
                }
                throw error;
            }
            return outcome ?? { ran: false };
        },
    };
}

/** Without a usable database there is nothing to lock (or record); the jobs skip on their own. */
const DEFAULT_RUN_LOCK: RunLock = {
    exclusive: (key, run) =>
        usableDatabaseUrl(process.env.DATABASE_URL)
            ? createPostgresRunLock().exclusive(key, run)
            : run().then((value) => ({ ran: true as const, value })),
};

export interface CronHandlerOptions extends RunJobDeps {
    /** The endpoint's path, for logs and the run lock. */
    route: string;
    jobs: readonly ScheduledJob[];
    /** Read per request. Default: process.env.CRON_SECRET. */
    secret?: () => string | undefined;
    /** Keeps overlapping runs (a manual run during the scheduled one) apart. Default: a Postgres advisory lock. */
    lock?: RunLock;
}

/**
 * A GET handler that checks the cron secret, then runs the jobs in order,
 * one run at a time: while a run holds the route's lock, another answers 409
 * CRON_RUNNING and runs nothing. It answers 200 when every job succeeded and
 * 500 when any failed (so the failure shows in Vercel's cron logs), with
 * each job's outcome either way.
 */
export function createCronHandler({
    route,
    jobs,
    secret = () => process.env.CRON_SECRET,
    lock = DEFAULT_RUN_LOCK,
    ...deps
}: CronHandlerOptions) {
    return async function GET(request: Request): Promise<NextResponse> {
        const auth = authorizeCronRequest(request, secret());
        if (!auth.ok) {
            logApiEvent("cron_refused", { route, status: auth.response.status });
            return auth.response;
        }

        const run = await lock.exclusive(`atlas:cron:${route}`, () => runJobs(jobs, deps));
        if (!run.ran) {
            logApiEvent("cron_skipped", { route, reason: "already running" });
            return apiError("A run of these jobs is already in progress.", "CRON_RUNNING", 409);
        }
        const outcomes = run.value;
        for (const outcome of outcomes) {
            logApiEvent("cron_job_finished", {
                route,
                job: outcome.job,
                status: outcome.status,
                durationMs: outcome.durationMs,
                error: outcome.error,
            });
        }

        const ok = outcomes.every((outcome) => outcome.status === "succeeded");
        return NextResponse.json(
            { ok, jobs: outcomes },
            { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } },
        );
    };
}
