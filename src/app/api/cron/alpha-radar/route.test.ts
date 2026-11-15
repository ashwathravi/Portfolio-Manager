import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { ALPHA_RADAR_JOB_BUDGET_MS, ALPHA_RADAR_JOBS } from "@/lib/alpha-radar/daily-refresh";

import { GET, maxDuration } from "./route";

// Only the refusals run here: a request that passed would ask SEC. The job
// itself is tested in src/lib/alpha-radar/daily-refresh.test.ts.
describe("GET /api/cron/alpha-radar", () => {
    afterEach(() => {
        delete process.env.CRON_SECRET;
    });

    test("answers 503 when CRON_SECRET is not set", async (t) => {
        t.mock.method(console, "info", () => {});

        const response = await GET(new Request("https://atlas.test/api/cron/alpha-radar", {
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

        for (const headers of [{}, { authorization: "Bearer wrong" }] as Array<Record<string, string>>) {
            const response = await GET(new Request("https://atlas.test/api/cron/alpha-radar", { headers }));
            assert.equal(response.status, 401, JSON.stringify(headers));
        }
    });

    test("runs the SEC job alone, with a minute to spare after its budget", () => {
        assert.deepEqual(ALPHA_RADAR_JOBS.map((job) => job.name), ["alpha-radar"]);
        assert.equal(maxDuration, 300);
        assert.ok(ALPHA_RADAR_JOB_BUDGET_MS <= (maxDuration - 60) * 1000);
    });
});
