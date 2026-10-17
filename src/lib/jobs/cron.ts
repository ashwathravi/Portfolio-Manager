/**
 * Cron endpoints (launch item i48). Vercel Cron calls the path with GET and
 * `Authorization: Bearer <CRON_SECRET>`. The proxy lets /api/cron/* through
 * without a session, so the check here is the only gate: every cron route
 * must be built with {@link createCronHandler}.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError, logApiEvent } from "@/lib/api/security";

import { runJobs, type RunJobDeps, type ScheduledJob } from "./runner";

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

export interface CronHandlerOptions extends RunJobDeps {
    /** The endpoint's path, for logs. */
    route: string;
    jobs: readonly ScheduledJob[];
    /** Read per request. Default: process.env.CRON_SECRET. */
    secret?: () => string | undefined;
}

/**
 * A GET handler that checks the cron secret, then runs the jobs in order.
 * It answers 200 when every job succeeded and 500 when any failed (so the
 * failure shows in Vercel's cron logs), with each job's outcome either way.
 */
export function createCronHandler({
    route,
    jobs,
    secret = () => process.env.CRON_SECRET,
    ...deps
}: CronHandlerOptions) {
    return async function GET(request: Request): Promise<NextResponse> {
        const auth = authorizeCronRequest(request, secret());
        if (!auth.ok) {
            logApiEvent("cron_refused", { route, status: auth.response.status });
            return auth.response;
        }

        const outcomes = await runJobs(jobs, deps);
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
