import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { authorizeCronRequest, buildTryRunLockQuery, createCronHandler, createPostgresRunLock, secretsMatch, type RunLock } from "./cron";
import type { JobRunStore, ScheduledJob } from "./runner";

const SECRET = "test-cron-secret-0123456789abcdef";

function cronRequest(authorization?: string): Request {
    return new Request("https://atlas.test/api/cron/daily", {
        headers: authorization === undefined ? {} : { authorization },
    });
}

function memoryStore(): JobRunStore & { finished: string[] } {
    let next = 0;
    const finished: string[] = [];
    return {
        finished,
        start: async () => `run-${++next}`,
        finish: async (id, result) => {
            finished.push(`${id}:${result.status}`);
        },
    };
}

function handler(jobs: ScheduledJob[], options: { secret?: string; store?: JobRunStore; lock?: RunLock } = {}) {
    // `in`, not a default: { secret: undefined } means "no secret configured".
    const secret = "secret" in options ? options.secret : SECRET;
    return createCronHandler({
        route: "/api/cron/daily",
        jobs,
        secret: () => secret,
        store: options.store ?? memoryStore(),
        lock: options.lock ?? freeLock().lock,
    });
}

/** A lock that is always free, recording the keys taken. */
function freeLock() {
    const keys: string[] = [];
    const lock: RunLock = {
        exclusive: async (key, run) => {
            keys.push(key);
            return { ran: true, value: await run() };
        },
    };
    return { lock, keys };
}

describe("authorizeCronRequest", () => {
    test("refuses everything with 503 when CRON_SECRET is unset or blank", async () => {
        for (const secret of [undefined, "", "   "]) {
            const result = authorizeCronRequest(cronRequest(`Bearer ${secret ?? ""}`), secret);
            assert.equal(result.ok, false);
            if (!result.ok) {
                assert.equal(result.response.status, 503);
                assert.deepEqual(await result.response.json(), {
                    error: "Scheduled jobs are not configured.",
                    code: "CRON_NOT_CONFIGURED",
                });
            }
        }
    });

    test("refuses a missing, wrong or malformed token with 401", async () => {
        for (const header of [undefined, "", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, `Basic ${SECRET}`, "Bearer "]) {
            const result = authorizeCronRequest(cronRequest(header), SECRET);
            assert.equal(result.ok, false, `accepted ${JSON.stringify(header)}`);
            if (!result.ok) {
                assert.equal(result.response.status, 401);
                assert.deepEqual(await result.response.json(), { error: "Unauthorized", code: "UNAUTHORIZED" });
            }
        }
    });

    test("accepts the exact bearer token", () => {
        assert.deepEqual(authorizeCronRequest(cronRequest(`Bearer ${SECRET}`), SECRET), { ok: true });
        // Surrounding whitespace in the configured value is ignored.
        assert.deepEqual(authorizeCronRequest(cronRequest(`Bearer ${SECRET}`), ` ${SECRET}\n`), { ok: true });
    });
});

describe("secretsMatch", () => {
    test("compares through timingSafeEqual, on equal-length digests", (t) => {
        const compare = t.mock.method(crypto, "timingSafeEqual");

        assert.equal(secretsMatch("Bearer abc", "Bearer abc"), true);
        assert.equal(secretsMatch("short", "a much longer expected value"), false);

        assert.equal(compare.mock.callCount(), 2);
        for (const call of compare.mock.calls) {
            const [a, b] = call.arguments as [Buffer, Buffer];
            assert.equal(a.length, 32);
            assert.equal(b.length, 32);
        }
    });
});

describe("createCronHandler", () => {
    test("runs nothing without CRON_SECRET", async () => {
        let ran = false;
        const response = await handler([{ name: "prices", run: async () => { ran = true; return {}; } }], { secret: undefined })(
            cronRequest(`Bearer ${SECRET}`),
        );

        assert.equal(response.status, 503);
        assert.equal(ran, false);
    });

    test("runs nothing for a wrong token", async () => {
        let ran = false;
        const response = await handler([{ name: "prices", run: async () => { ran = true; return {}; } }])(
            cronRequest("Bearer wrong"),
        );

        assert.equal(response.status, 401);
        assert.equal(ran, false);
    });

    test("runs every job in order and reports each one", async (t) => {
        t.mock.method(console, "info", () => {});
        const order: string[] = [];
        const store = memoryStore();

        const response = await handler([
            { name: "expired-sessions", run: async () => { order.push("expired-sessions"); return { deleted: 2 }; } },
            { name: "prices", run: async () => { order.push("prices"); return { days: [] }; } },
        ], { store })(cronRequest(`Bearer ${SECRET}`));
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.deepEqual(order, ["expired-sessions", "prices"]);
        assert.equal(body.ok, true);
        assert.deepEqual(
            body.jobs.map((job: { job: string; status: string; detail: unknown }) => [job.job, job.status, job.detail]),
            [["expired-sessions", "succeeded", { deleted: 2 }], ["prices", "succeeded", { days: [] }]],
        );
        assert.deepEqual(store.finished, ["run-1:succeeded", "run-2:succeeded"]);
    });

    test("a failing job doesn't stop the next one, and the response says it failed", async (t) => {
        const logs: string[] = [];
        t.mock.method(console, "info", (line: string) => { logs.push(line); });
        let secondRan = false;

        const response = await handler([
            { name: "expired-sessions", run: async () => { throw new Error("relation \"auth_sessions\" does not exist"); } },
            { name: "prices", run: async () => { secondRan = true; return {}; } },
        ])(cronRequest(`Bearer ${SECRET}`));
        const body = await response.json();

        assert.equal(response.status, 500);
        assert.equal(secondRan, true);
        assert.equal(body.ok, false);
        assert.deepEqual(body.jobs.map((job: { status: string }) => job.status), ["failed", "succeeded"]);
        assert.equal(body.jobs[0].error, "relation \"auth_sessions\" does not exist");
        assert.equal(logs.length, 2);
        assert.ok(logs.every((line) => !line.includes(SECRET)));
    });

    test("log lines carry Vercel's request ID", async (t) => {
        const logs: string[] = [];
        t.mock.method(console, "info", (line: string) => { logs.push(line); });
        const request = new Request("https://atlas.test/api/cron/daily", {
            headers: { authorization: `Bearer ${SECRET}`, "x-vercel-id": "pdx1::abcde-1760745600000-0123456789ab" },
        });

        await handler([{ name: "prices", run: async () => ({}) }])(request);

        assert.equal(logs.length, 1);
        assert.equal(JSON.parse(logs[0]).requestId, "pdx1::abcde-1760745600000-0123456789ab");
    });
});

describe("cron run lock", () => {
    test("a run while another holds the lock runs nothing and answers 409 CRON_RUNNING", async (t) => {
        t.mock.method(console, "info", () => {});
        let ran = false;
        const busy: RunLock = { exclusive: async () => ({ ran: false }) };

        const response = await handler([{ name: "prices", run: async () => { ran = true; return {}; } }], { lock: busy })(
            cronRequest(`Bearer ${SECRET}`),
        );

        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { error: "A run of these jobs is already in progress.", code: "CRON_RUNNING" });
        assert.equal(ran, false);
    });

    test("the jobs run under the route's lock, taken only after the secret checks out", async (t) => {
        t.mock.method(console, "info", () => {});
        const { lock, keys } = freeLock();
        const jobs = [{ name: "prices", run: async () => ({}) }];

        assert.equal((await handler(jobs, { lock })(cronRequest("Bearer wrong"))).status, 401);
        assert.deepEqual(keys, []);
        assert.equal((await handler(jobs, { lock })(cronRequest(`Bearer ${SECRET}`))).status, 200);
        assert.deepEqual(keys, ["atlas:cron:/api/cron/daily"]);
    });

    test("the lock is a transaction-scoped advisory lock that never waits", () => {
        const query = buildTryRunLockQuery("atlas:cron:/api/cron/daily");
        const { sql, params } = query.toQuery({
            escapeName: (name: string) => `"${name}"`,
            escapeParam: (index: number) => `$${index + 1}`,
            escapeString: (value: string) => `'${value}'`,
        } as never);
        assert.equal(sql, "select pg_try_advisory_xact_lock(hashtext($1)) as locked");
        assert.deepEqual(params, ["atlas:cron:/api/cron/daily"]);
    });
});

describe("createPostgresRunLock", () => {
    /** A database whose transaction answers the lock query, and can fail on commit. */
    function fakeDatabase({ locked, commitFails = false }: { locked: boolean; commitFails?: boolean }) {
        const database = {
            transaction: async (body: (tx: { execute: () => Promise<unknown> }) => Promise<void>) => {
                await body({ execute: async () => [{ locked }] });
                if (commitFails) throw new Error("connection closed");
            },
        };
        return database as never;
    }

    test("runs when the lock is free, and not at all when it is held", async () => {
        let runs = 0;
        const run = async () => ++runs;
        assert.deepEqual(await createPostgresRunLock(fakeDatabase({ locked: true })).exclusive("k", run), { ran: true, value: 1 });
        assert.deepEqual(await createPostgresRunLock(fakeDatabase({ locked: false })).exclusive("k", run), { ran: false });
        assert.equal(runs, 1);
    });

    test("a failure releasing the lock after the run doesn't turn the run into a failure", async (t) => {
        t.mock.method(console, "warn", () => {});
        const outcome = await createPostgresRunLock(fakeDatabase({ locked: true, commitFails: true })).exclusive("k", async () => "done");
        assert.deepEqual(outcome, { ran: true, value: "done" });
    });

    test("a run that throws is reported, not swallowed", async () => {
        await assert.rejects(
            createPostgresRunLock(fakeDatabase({ locked: true })).exclusive("k", async () => { throw new Error("job crashed"); }),
            /job crashed/,
        );
    });
});
