import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { DAILY_JOBS } from "@/lib/jobs/daily-jobs";
import { DEFAULT_BUDGET_MS } from "@/lib/markets/price-ingest";
import { PLAID_JOB_BUDGET_MS } from "@/lib/plaid/sync";

import { GET, maxDuration } from "./route";

// Only the refusals run here: a request that passed would run the real jobs.
// src/lib/jobs/cron.test.ts covers the authorized path with injected jobs.
describe("GET /api/cron/daily", () => {
    afterEach(() => {
        delete process.env.CRON_SECRET;
    });

    test("answers 503 when CRON_SECRET is not set", async (t) => {
        t.mock.method(console, "info", () => {});

        const response = await GET(new Request("https://atlas.test/api/cron/daily", {
            headers: { authorization: "Bearer anything" },
        }));

        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            error: "Scheduled jobs are not configured.",
            code: "CRON_NOT_CONFIGURED",
        });
    });

    test("answers 401 without the right bearer token", async (t) => {
        t.mock.method(console, "info", () => {});
        process.env.CRON_SECRET = "route-test-secret-value";

        const attempts: Array<Record<string, string>> = [{}, { authorization: "Bearer wrong" }, { "x-api-key": "route-test-secret-value" }];
        for (const headers of attempts) {
            const response = await GET(new Request("https://atlas.test/api/cron/daily", { headers }));
            assert.equal(response.status, 401, JSON.stringify(headers));
        }
    });

    test("runs the session cleanup, the linked-account sync, the price ingest, then the snapshots valued at those prices, with room for the budgets", () => {
        assert.deepEqual(DAILY_JOBS.map((job) => job.name), ["expired-sessions", "ask-history", "plaid", "prices", "snapshots"]);
        assert.equal(maxDuration, 300);
        // The sync and the price backfill each stop at their budget, together
        // short of the limit, leaving the cleanup and snapshots room.
        assert.ok(PLAID_JOB_BUDGET_MS + DEFAULT_BUDGET_MS <= (maxDuration - 20) * 1000);
    });
});
