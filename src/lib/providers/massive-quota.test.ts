import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryRateLimitStore } from "@/lib/api/rate-limit";

import {
    createProviderQuota,
    getMassiveQuota,
    MASSIVE_CALLS_PER_MINUTE,
    massiveQuotaKey,
    setQuotaStoreForTests,
} from "./massive-quota";

describe("massiveQuotaKey", () => {
    test("names the bucket after the API key's hash, never the key", () => {
        const key = massiveQuotaKey("secret-test-key");
        assert.match(key, /^provider:massive:[0-9a-f]{16}$/);
        assert.ok(!key.includes("secret"));
        assert.equal(massiveQuotaKey(" secret-test-key "), key);
        assert.notEqual(massiveQuotaKey("another-key"), key);
    });
});

describe("createProviderQuota", () => {
    test("allows the plan's five calls a minute, then says how long to wait", async () => {
        let now = 0;
        const quota = createProviderQuota(createMemoryRateLimitStore(() => now), "provider:massive:k");
        assert.equal(MASSIVE_CALLS_PER_MINUTE.limit, 5);
        for (let i = 0; i < 5; i++) assert.deepEqual(await quota.reserve(), { allowed: true });

        now = 20_000;
        assert.deepEqual(await quota.reserve(), { allowed: false, retryAfterMs: 40_000 });

        now = 60_000;
        assert.deepEqual(await quota.reserve(), { allowed: true });
    });

    test("callers with the same key share one budget; another key has its own", async () => {
        const store = createMemoryRateLimitStore(() => 0);
        const ingest = createProviderQuota(store, massiveQuotaKey("k1"));
        const routes = createProviderQuota(store, massiveQuotaKey("k1"));
        const other = createProviderQuota(store, massiveQuotaKey("k2"));
        for (let i = 0; i < 3; i++) await ingest.reserve();
        for (let i = 0; i < 2; i++) await routes.reserve();
        assert.equal((await ingest.reserve()).allowed, false);
        assert.equal((await routes.reserve()).allowed, false);
        assert.equal((await other.reserve()).allowed, true);
    });
});

describe("getMassiveQuota", () => {
    afterEach(() => setQuotaStoreForTests(null));

    test("uses the shared quota store", async () => {
        const store = createMemoryRateLimitStore(() => 0);
        setQuotaStoreForTests(store);
        for (let i = 0; i < 5; i++) await getMassiveQuota("k").reserve();
        assert.equal((await getMassiveQuota("k").reserve()).allowed, false);
    });
});
