import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createReadinessCheck } from "./readiness.ts";

describe("createReadinessCheck", () => {
    test("reports ok when the database answers", async () => {
        const check = createReadinessCheck({ isConfigured: () => true, ping: async () => [{ "?column?": 1 }] });

        const result = await check();

        assert.equal(result.status, "ok");
        assert.equal(result.database, "ok");
    });

    test("reports not_configured without pinging when no database is set", async () => {
        let pings = 0;
        const check = createReadinessCheck({
            isConfigured: () => false,
            ping: async () => {
                pings += 1;
            },
        });

        assert.deepEqual((await check()).database, "not_configured");
        assert.equal((await check()).status, "degraded");
        assert.equal(pings, 0);
    });

    test("reports unavailable when the ping fails, without leaking the error", async () => {
        const check = createReadinessCheck({
            isConfigured: () => true,
            ping: async () => {
                throw new Error("password authentication failed for user atlas_app");
            },
        });

        const result = await check();

        assert.equal(result.database, "unavailable");
        assert.ok(!JSON.stringify(result).includes("password"));
    });

    test("treats a ping slower than the timeout as unavailable", async () => {
        const check = createReadinessCheck({
            isConfigured: () => true,
            ping: () => new Promise(() => {}),
            timeoutMs: 20,
        });

        assert.equal((await check()).database, "unavailable");
    });

    test("reuses a result until it expires and shares one in-flight ping", async () => {
        let clock = 0;
        let pings = 0;
        const check = createReadinessCheck({
            isConfigured: () => true,
            ping: async () => {
                pings += 1;
            },
            cacheMs: 1_000,
            now: () => clock,
        });

        await Promise.all([check(), check(), check()]);
        assert.equal(pings, 1);

        clock = 999;
        await check();
        assert.equal(pings, 1);

        clock = 1_001;
        await check();
        assert.equal(pings, 2);
    });
});
