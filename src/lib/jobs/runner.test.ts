import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    buildFinishJobRunQuery,
    buildStartJobRunQuery,
    runJob,
    runJobs,
    summarizeError,
    type JobRunStore,
} from "./runner";

const START = new Date("2026-10-16T22:30:00.000Z");

/** A clock that moves forward one second each time it is read. */
function tickingClock(start = START) {
    let current = start.getTime();
    return () => {
        const reading = new Date(current);
        current += 1_000;
        return reading;
    };
}

function memoryStore() {
    const rows = new Map<string, Record<string, unknown>>();
    const store: JobRunStore = {
        async start(job, startedAt) {
            const id = `run-${rows.size + 1}`;
            rows.set(id, { job, startedAt, status: "running" });
            return id;
        },
        async finish(id, result) {
            rows.set(id, { ...rows.get(id), ...result });
        },
    };
    return { store, rows };
}

describe("runJob", () => {
    test("records a running row, then the job's detail when it succeeds", async () => {
        const { store, rows } = memoryStore();
        const seen: unknown[] = [];

        const outcome = await runJob("prices", async () => {
            seen.push(rows.get("run-1")?.status);
            return { stored: 12 };
        }, { store, now: tickingClock() });

        assert.deepEqual(seen, ["running"]);
        assert.deepEqual(outcome, {
            job: "prices",
            status: "succeeded",
            runId: "run-1",
            startedAt: START.toISOString(),
            durationMs: 1_000,
            detail: { stored: 12 },
        });
        assert.deepEqual(rows.get("run-1"), {
            job: "prices",
            startedAt: START,
            status: "succeeded",
            finishedAt: new Date(START.getTime() + 2_000),
            detail: { stored: 12 },
            error: null,
        });
    });

    test("records a failure with a short message instead of throwing", async () => {
        const { store, rows } = memoryStore();

        const outcome = await runJob("prices", async () => {
            throw new Error("Massive answered 500\n    at fetchOnce (adapter.ts:1:1)");
        }, { store, now: tickingClock() });

        assert.equal(outcome.status, "failed");
        assert.equal(outcome.error, "Massive answered 500");
        assert.equal(outcome.detail, undefined);
        assert.equal(rows.get("run-1")?.status, "failed");
        assert.equal(rows.get("run-1")?.error, "Massive answered 500");
        assert.equal(rows.get("run-1")?.detail, null);
    });

    test("does not run the job when its start can't be recorded", async () => {
        let ran = false;
        const store: JobRunStore = {
            start: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); },
            finish: async () => { throw new Error("unreachable"); },
        };

        const outcome = await runJob("prices", async () => {
            ran = true;
            return {};
        }, { store, now: tickingClock() });

        assert.equal(ran, false);
        assert.equal(outcome.status, "failed");
        assert.equal(outcome.runId, null);
        assert.equal(outcome.error, "Could not record the run: connect ECONNREFUSED 127.0.0.1:5432");
    });

    test("still reports the job's result when finishing the row fails", async (t) => {
        const errors: unknown[] = [];
        t.mock.method(console, "error", (message: unknown) => { errors.push(message); });
        const store: JobRunStore = {
            start: async () => "run-1",
            finish: async () => { throw new Error("connection lost"); },
        };

        const outcome = await runJob("prices", async () => ({ stored: 3 }), { store, now: tickingClock() });

        assert.equal(outcome.status, "succeeded");
        assert.deepEqual(outcome.detail, { stored: 3 });
        assert.deepEqual(errors, ["Could not record the end of job run run-1 (prices): connection lost"]);
    });
});

describe("runJobs", () => {
    test("runs jobs in order and keeps going after one fails", async () => {
        const { store } = memoryStore();
        const order: string[] = [];

        const outcomes = await runJobs([
            { name: "first", run: async () => { order.push("first"); throw new Error("boom"); } },
            { name: "second", run: async () => { order.push("second"); return { ok: 1 }; } },
        ], { store, now: tickingClock() });

        assert.deepEqual(order, ["first", "second"]);
        assert.deepEqual(outcomes.map((outcome) => [outcome.job, outcome.status, outcome.runId]), [
            ["first", "failed", "run-1"],
            ["second", "succeeded", "run-2"],
        ]);
    });
});

describe("summarizeError", () => {
    test("masks secret values from the environment", () => {
        const env = { POLYGON_API_KEY: "pk_live_abcdef123456", CRON_SECRET: "cron-secret-value" };
        assert.equal(
            summarizeError(new Error("bad key pk_live_abcdef123456 and cron-secret-value"), env),
            "bad key *** and ***",
        );
    });

    test("masks URL credentials and apiKey parameters", () => {
        assert.equal(
            summarizeError(new Error("connect postgres://atlas_app:hunter22@db.example.com:6543/postgres failed"), {}),
            "connect postgres://***@db.example.com:6543/postgres failed",
        );
        assert.equal(
            summarizeError(new Error("GET https://api.polygon.io/v2/aggs?adjusted=true&apiKey=abc123&x=1"), {}),
            "GET https://api.polygon.io/v2/aggs?adjusted=true&apiKey=***&x=1",
        );
    });

    test("keeps the first line, trimmed and cut to 300 characters", () => {
        assert.equal(summarizeError(new Error("  first line  \nsecond line"), {}), "first line");
        const long = summarizeError(new Error("x".repeat(500)), {});
        assert.equal(long.length, 300);
        assert.ok(long.endsWith("…"));
    });

    test("describes non-Error values and empty messages", () => {
        assert.equal(summarizeError("plain string", {}), "plain string");
        assert.equal(summarizeError(new TypeError(""), {}), "TypeError");
        assert.equal(summarizeError(undefined, {}), "undefined");
    });

    test("ignores short environment values that would mask ordinary words", () => {
        assert.equal(summarizeError(new Error("the test failed"), { CRON_SECRET: "test" }), "the test failed");
    });
});

describe("job run queries", () => {
    test("a run starts as a running row and returns its id", () => {
        const { sql, params } = buildStartJobRunQuery("prices", START).toSQL();
        assert.match(sql, /insert into "job_runs" \("id", "job", "started_at", "finished_at", "status", "detail", "error"\)/i);
        assert.match(sql, /returning "id"/i);
        assert.ok(params.includes("prices"));
        assert.ok(params.includes("running"));
        assert.ok(params.includes(START.toISOString()));
    });

    test("finishing updates only that run", () => {
        const { sql, params } = buildFinishJobRunQuery("run-1", {
            status: "succeeded",
            finishedAt: new Date("2026-10-16T22:31:00.000Z"),
            detail: { stored: 1 },
            error: null,
        }).toSQL();
        assert.match(sql, /update "job_runs" set "finished_at" = \$\d+, "status" = \$\d+, "detail" = \$\d+, "error" = \$\d+ where "job_runs"\."id" = \$\d+/i);
        assert.deepEqual(params, ["2026-10-16T22:31:00.000Z", "succeeded", JSON.stringify({ stored: 1 }), null, "run-1"]);
    });
});
