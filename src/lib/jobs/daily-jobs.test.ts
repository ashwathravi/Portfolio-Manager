import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { assessJob, JOB_SCHEDULES } from "@/lib/health/job-health";
import { createIngestAdapter, DEFAULT_BUDGET_MS, ingestDailyPrices } from "@/lib/markets/price-ingest";
import { setErrorReporterForTests } from "@/lib/observability/report-error";

import { refreshMarketData } from "./daily-jobs";
import { runJob, type JobRunStore } from "./runner";

describe("refreshMarketData", () => {
    afterEach(() => setErrorReporterForTests(null));

    test("refreshes the symbol directory first, then prices within what's left of their budget", async () => {
        const order: string[] = [];
        let clock = 1_000;
        let budget: number | undefined;
        const detail = await refreshMarketData({
            now: () => clock,
            directory: async () => {
                order.push("directory");
                clock += 1_500;
                return { entries: 9_900, added: 12, removed: 3 };
            },
            prices: async (options) => {
                order.push("prices");
                budget = options?.budgetMs;
                return { session: "2026-11-06", tracked: 11 };
            },
        });

        assert.deepEqual(order, ["directory", "prices"]);
        assert.equal(budget, DEFAULT_BUDGET_MS - 1_500);
        assert.deepEqual(detail, {
            session: "2026-11-06",
            tracked: 11,
            symbolDirectory: { entries: 9_900, added: 12, removed: 3 },
        });
    });

    test("regression: without a market data key the directory still refreshes, and job health reports prices as failed", async () => {
        const reported: unknown[] = [];
        setErrorReporterForTests({
            capture: (error) => { reported.push(error); },
            afterResponse: () => {},
        });
        const finished: Array<Parameters<JobRunStore["finish"]>[1]> = [];
        const store: JobRunStore = {
            start: async () => "run-1",
            finish: async (_id, result) => { finished.push(result); },
        };
        const startedAt = new Date("2026-11-06T22:31:00.000Z");
        let directoryRefreshed = false;

        const outcome = await runJob(
            "prices",
            () => refreshMarketData({
                directory: async () => {
                    directoryRefreshed = true;
                    return { entries: 9_900, added: 12, removed: 3 };
                },
                prices: (options) => ingestDailyPrices({ ...options, adapter: createIngestAdapter({}, "") }),
            }),
            { store, now: () => startedAt },
        );

        assert.equal(directoryRefreshed, true);
        assert.equal(outcome.status, "failed");
        assert.match(outcome.error ?? "", /POLYGON_API_KEY/);
        assert.equal(finished[0].status, "failed");
        assert.equal(reported.length, 1);

        const schedule = JOB_SCHEDULES.find(({ job }) => job === "prices")!;
        const health = assessJob(
            schedule,
            { job: "prices", lastSucceededAt: null, latestStartedAt: startedAt, latestStatus: outcome.status },
            new Date("2026-11-07T00:30:00.000Z"),
        );
        assert.equal(health.status, "failed");
    });
});
