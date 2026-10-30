import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DAILY_JOBS } from "@/lib/jobs/daily-jobs";

import {
    assessJob,
    BACKUP_CRON,
    BACKUP_JOB,
    buildJobHealthQuery,
    createJobHealthCheck,
    DAILY_JOB_NAMES,
    DAILY_JOBS_CRON,
    JOB_SCHEDULES,
    lastDueSlot,
    parseDailyCron,
    STUCK_AFTER_MS,
    type JobRunSummary,
    type JobSchedule,
} from "./job-health.ts";

const NIGHTLY: JobSchedule = { job: "prices", cron: DAILY_JOBS_CRON, graceMinutes: 120 };
const BACKUP: JobSchedule = { job: BACKUP_JOB, cron: BACKUP_CRON, graceMinutes: 240 };

const at = (iso: string) => new Date(iso);
// 2026-10-26 is a Monday.
const MONDAY = "2026-10-26";

function summary(fields: Partial<JobRunSummary> = {}): JobRunSummary {
    return { job: "prices", lastSucceededAt: null, latestStartedAt: null, latestStatus: null, ...fields };
}

describe("the schedules match what runs the jobs", () => {
    test("the nightly jobs are the ones /api/cron/daily runs", () => {
        assert.deepEqual([...DAILY_JOB_NAMES], DAILY_JOBS.map((job) => job.name));
    });

    test("vercel.json runs /api/cron/daily on the nightly schedule", () => {
        const { crons } = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
        assert.equal(crons.find((cron) => cron.path === "/api/cron/daily")?.schedule, DAILY_JOBS_CRON);
    });

    test("the backup workflow runs on the backup schedule", () => {
        const workflow = readFileSync(".github/workflows/database-backup.yml", "utf8");
        assert.deepEqual([...workflow.matchAll(/- cron: '([^']+)'/g)].map((match) => match[1]), [BACKUP_CRON]);
    });

    test("every job is watched once", () => {
        const jobs = JOB_SCHEDULES.map((schedule) => schedule.job);
        assert.deepEqual(jobs, [...DAILY_JOB_NAMES, BACKUP_JOB]);
        for (const schedule of JOB_SCHEDULES) assert.doesNotThrow(() => parseDailyCron(schedule.cron));
    });
});

describe("parseDailyCron", () => {
    test("reads the hour and the weekdays", () => {
        assert.deepEqual(parseDailyCron("30 22 * * 1-5"), { hour: 22, days: new Set([1, 2, 3, 4, 5]) });
        assert.deepEqual(parseDailyCron("41 6 * * *"), { hour: 6, days: new Set([0, 1, 2, 3, 4, 5, 6]) });
        assert.deepEqual(parseDailyCron("0 3 * * 0,6"), { hour: 3, days: new Set([0, 6]) });
    });

    test("refuses schedules it can't check", () => {
        for (const cron of ["*/5 * * * *", "0 22 1 * *", "0 22 * 1 *", "0 24 * * *", "0 22 * * 7", "0 22 * * 5-1", "0 22 * *"]) {
            assert.throws(() => parseDailyCron(cron), /Unsupported/, cron);
        }
    });
});

describe("lastDueSlot", () => {
    test("a weekday run falls due two hours after its hour begins", () => {
        assert.equal(at(`${MONDAY}T00:00:00Z`).getUTCDay(), 1);
        // Tuesday 23:59: Tuesday's run isn't due until midnight, so Monday's is.
        assert.equal(lastDueSlot(NIGHTLY, at("2026-10-27T23:59:59Z")).toISOString(), `${MONDAY}T22:00:00.000Z`);
        assert.equal(lastDueSlot(NIGHTLY, at("2026-10-28T00:00:00Z")).toISOString(), "2026-10-27T22:00:00.000Z");
    });

    test("over the weekend and on Monday, Friday's run is the one due", () => {
        for (const now of ["2026-10-31T12:00:00Z", "2026-11-01T23:00:00Z", "2026-11-02T23:59:00Z"]) {
            assert.equal(lastDueSlot(NIGHTLY, at(now)).toISOString(), "2026-10-30T22:00:00.000Z", now);
        }
        assert.equal(lastDueSlot(NIGHTLY, at("2026-11-03T00:00:00Z")).toISOString(), "2026-11-02T22:00:00.000Z");
    });

    test("the backup falls due four hours after 06:00 every day", () => {
        assert.equal(lastDueSlot(BACKUP, at("2026-11-01T09:59:59Z")).toISOString(), "2026-10-31T06:00:00.000Z");
        assert.equal(lastDueSlot(BACKUP, at("2026-11-01T10:00:00Z")).toISOString(), "2026-11-01T06:00:00.000Z");
    });
});

describe("assessJob", () => {
    const now = at("2026-10-28T09:00:00Z"); // Monday's run was due; Tuesday's too.
    const due = "2026-10-27T22:00:00.000Z";

    test("ok when it succeeded since its run fell due, a manual run included", () => {
        assert.deepEqual(
            assessJob(NIGHTLY, summary({ lastSucceededAt: at("2026-10-27T22:31:00Z"), latestStartedAt: at("2026-10-27T22:31:00Z"), latestStatus: "succeeded" }), now),
            { job: "prices", status: "ok", lastSucceededAt: "2026-10-27T22:31:00.000Z", dueSince: due },
        );
        // A later manual run that failed doesn't undo the scheduled success.
        assert.equal(
            assessJob(NIGHTLY, summary({ lastSucceededAt: at("2026-10-27T22:31:00Z"), latestStartedAt: at("2026-10-28T08:00:00Z"), latestStatus: "failed" }), now).status,
            "ok",
        );
    });

    test("late when it never ran", () => {
        assert.deepEqual(assessJob(NIGHTLY, undefined, now), { job: "prices", status: "late", lastSucceededAt: null, dueSince: due });
    });

    test("late when nothing ran since it fell due, even if an older run failed", () => {
        const lastWeek = summary({ lastSucceededAt: at("2026-10-23T22:30:00Z"), latestStartedAt: at("2026-10-26T22:30:00Z"), latestStatus: "failed" });
        assert.deepEqual(assessJob(NIGHTLY, lastWeek, now), { job: "prices", status: "late", lastSucceededAt: "2026-10-23T22:30:00.000Z", dueSince: due });
    });

    test("failed when the run since it fell due failed", () => {
        const failed = summary({ lastSucceededAt: at("2026-10-26T22:30:00Z"), latestStartedAt: at("2026-10-27T22:30:00Z"), latestStatus: "failed" });
        assert.equal(assessJob(NIGHTLY, failed, now).status, "failed");
    });

    test("a run still going is late until it has been running too long to finish", () => {
        const started = at("2026-10-28T08:50:00Z");
        const running = summary({ latestStartedAt: started, latestStatus: "running" });
        assert.equal(assessJob(NIGHTLY, running, now).status, "late");
        assert.equal(assessJob(NIGHTLY, running, new Date(started.getTime() + STUCK_AFTER_MS + 1)).status, "failed");
    });
});

describe("createJobHealthCheck", () => {
    const now = () => at("2026-10-28T09:00:00Z").getTime();
    const succeeded = (job: string): JobRunSummary => ({
        job,
        lastSucceededAt: at("2026-10-27T22:31:00Z"),
        latestStartedAt: at("2026-10-27T22:31:00Z"),
        latestStatus: "succeeded",
    });
    const backupSucceeded: JobRunSummary = { ...succeeded(BACKUP_JOB), lastSucceededAt: at("2026-10-28T06:50:00Z"), latestStartedAt: at("2026-10-28T06:50:00Z") };

    test("ok when every job ran on time, asking for every scheduled job", async () => {
        let asked: readonly string[] = [];
        const check = createJobHealthCheck({
            isConfigured: () => true,
            load: async (jobs) => {
                asked = jobs;
                return [...DAILY_JOB_NAMES.map(succeeded), backupSucceeded];
            },
            now,
        });

        const report = await check();

        assert.deepEqual(asked, JOB_SCHEDULES.map((schedule) => schedule.job));
        assert.equal(report.status, "ok");
        assert.equal(report.database, "ok");
        assert.deepEqual(report.jobs.map((job) => [job.job, job.status]), JOB_SCHEDULES.map((schedule) => [schedule.job, "ok"]));
        assert.equal(report.checkedAt, "2026-10-28T09:00:00.000Z");
    });

    test("degraded when any job is late or failed, listing every job", async () => {
        const check = createJobHealthCheck({
            isConfigured: () => true,
            load: async () => [succeeded("prices"), { ...succeeded("plaid"), latestStartedAt: at("2026-10-28T08:00:00Z"), latestStatus: "failed", lastSucceededAt: at("2026-10-26T22:30:00Z") }],
            now,
        });

        const report = await check();

        assert.equal(report.status, "degraded");
        assert.equal(report.database, "ok");
        const statuses = Object.fromEntries(report.jobs.map((job) => [job.job, job.status]));
        assert.deepEqual(statuses, { "expired-sessions": "late", "ask-history": "late", plaid: "failed", prices: "ok", snapshots: "late", backup: "late" });
    });

    test("not_configured without loading when no database is set", async () => {
        let loads = 0;
        const check = createJobHealthCheck({ isConfigured: () => false, load: async () => { loads += 1; return []; }, now });

        assert.deepEqual(await check(), { status: "degraded", database: "not_configured", jobs: [], checkedAt: "2026-10-28T09:00:00.000Z" });
        assert.equal(loads, 0);
    });

    test("unavailable when the load fails, without the error", async () => {
        const check = createJobHealthCheck({
            isConfigured: () => true,
            load: async () => {
                throw new Error("password authentication failed for user atlas_app");
            },
            now,
        });

        const report = await check();

        assert.equal(report.database, "unavailable");
        assert.equal(report.status, "degraded");
        assert.deepEqual(report.jobs, []);
        assert.doesNotMatch(JSON.stringify(report), /password|atlas_app/);
    });

    test("unavailable when the load takes too long", async () => {
        const check = createJobHealthCheck({ isConfigured: () => true, load: () => new Promise(() => {}), timeoutMs: 5, now });

        assert.equal((await check()).database, "unavailable");
    });

    test("a load that outlived its timeout blocks the next one until it settles", async () => {
        let clock = now();
        let loads = 0;
        let release: (summaries: JobRunSummary[]) => void = () => {};
        const check = createJobHealthCheck({
            isConfigured: () => true,
            load: () => {
                loads += 1;
                return loads === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.resolve([succeeded("prices")]);
            },
            timeoutMs: 5,
            now: () => clock,
        });

        assert.equal((await check()).database, "unavailable");
        clock += 10_000;
        assert.equal((await check()).database, "unavailable");
        assert.equal(loads, 1);

        release([]);
        await new Promise((resolve) => setImmediate(resolve));
        clock += 10_000;
        assert.equal((await check()).database, "ok");
        assert.equal(loads, 2);
    });

    test("reuses a report for a minute and an outage for ten seconds, sharing one load", async () => {
        let clock = now();
        let loads = 0;
        let fail = false;
        const check = createJobHealthCheck({
            isConfigured: () => true,
            load: async () => {
                loads += 1;
                if (fail) throw new Error("down");
                return [succeeded("prices")];
            },
            now: () => clock,
        });

        await Promise.all([check(), check(), check()]);
        assert.equal(loads, 1);
        clock += 59_999;
        await check();
        assert.equal(loads, 1);
        clock += 1;
        fail = true;
        assert.equal((await check()).database, "unavailable");
        assert.equal(loads, 2);
        clock += 10_000;
        fail = false;
        assert.equal((await check()).database, "ok");
        assert.equal(loads, 3);
    });
});

test("buildJobHealthQuery reads each job's last success and latest run in one grouped query", () => {
    const query = buildJobHealthQuery(["prices", BACKUP_JOB]).toSQL();

    assert.match(query.sql, /max\("started_at"\) filter \(where "status" = 'succeeded'\)/);
    assert.match(query.sql, /\(array_agg\("status" order by "started_at" desc\)\)\[1\]/);
    assert.match(query.sql, /where "job_runs"\."job" in \(\$1, \$2\) group by "job_runs"\."job"/);
    assert.deepEqual(query.params, ["prices", BACKUP_JOB]);
});
