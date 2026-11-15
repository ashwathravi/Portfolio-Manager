import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryRateLimitStore } from "./rate-limit";
import { consumeDailyQuota, DAILY_QUOTAS, describeWait, type DailyQuota } from "./daily-quota";

const HOUR_MS = 60 * 60 * 1000;

describe("daily quotas (launch item i77)", () => {
    afterEach(() => {
        delete process.env.API_RATE_LIMIT_DISABLED;
    });

    for (const quota of Object.keys(DAILY_QUOTAS) as DailyQuota[]) {
        test(`${quota}: ${DAILY_QUOTAS[quota].limit} a day, then 429 DAILY_QUOTA_REACHED with how long to wait`, async () => {
            let now = 0;
            const store = createMemoryRateLimitStore(() => now);
            const { limit, reached } = DAILY_QUOTAS[quota];

            for (let i = 0; i < limit; i++) {
                assert.equal(await consumeDailyQuota("user-a", quota, store), undefined, `use ${i + 1}`);
            }
            now = 19 * HOUR_MS;
            const refused = await consumeDailyQuota("user-a", quota, store);

            assert.equal(refused?.status, 429);
            assert.equal(refused?.headers.get("Retry-After"), String(5 * 60 * 60));
            assert.deepEqual(await refused?.json(), {
                error: `${reached} Try again in about 5 hours.`,
                code: "DAILY_QUOTA_REACHED",
            });

            // The next day starts afresh.
            now = 24 * HOUR_MS;
            assert.equal(await consumeDailyQuota("user-a", quota, store), undefined);
        });
    }

    test("each user, and each quota, is counted apart", async () => {
        const store = createMemoryRateLimitStore(() => 0);
        for (let i = 0; i < DAILY_QUOTAS.imports.limit; i++) await consumeDailyQuota("user-a", "imports", store);

        assert.equal((await consumeDailyQuota("user-a", "imports", store))?.status, 429);
        assert.equal(await consumeDailyQuota("user-b", "imports", store), undefined);
        assert.equal(await consumeDailyQuota("user-a", "backtests", store), undefined);
    });

    test("API_RATE_LIMIT_DISABLED turns them off, as it does the rate limits", async () => {
        process.env.API_RATE_LIMIT_DISABLED = "1";
        const store = createMemoryRateLimitStore(() => 0);
        for (let i = 0; i <= DAILY_QUOTAS.bankLinks.limit; i++) {
            assert.equal(await consumeDailyQuota("user-a", "bankLinks", store), undefined);
        }
    });

    test("describeWait rounds to what a person would say", () => {
        assert.equal(describeWait(1), "a minute");
        assert.equal(describeWait(60), "a minute");
        assert.equal(describeWait(61), "2 minutes");
        assert.equal(describeWait(59 * 60), "59 minutes");
        assert.equal(describeWait(60 * 60), "about an hour");
        assert.equal(describeWait(89 * 60), "about an hour");
        assert.equal(describeWait(90 * 60), "about 2 hours");
        assert.equal(describeWait(23.9 * 60 * 60), "about 24 hours");
    });
});
