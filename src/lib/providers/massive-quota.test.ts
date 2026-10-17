import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    createMemoryQuotaStore,
    createProviderQuota,
    createRedisQuotaStore,
    getMassiveQuota,
    MASSIVE_CALLS_PER_MINUTE,
    MASSIVE_QUOTA_KEY,
    setQuotaStoreForTests,
    type QuotaRedis,
    type QuotaStore,
} from "./massive-quota";

/** Five calls, then a sixth within a rolling minute must wait for the oldest to age out. */
async function checkRollingWindow(makeStore: (now: () => number) => QuotaStore) {
    let now = 1_000_000;
    const quota = createProviderQuota(makeStore(() => now), "provider:massive:k");
    const { limit, windowMs } = MASSIVE_CALLS_PER_MINUTE;
    assert.equal(limit, 5);
    assert.ok(windowMs >= 60_000);

    // Four calls early in the window, one just before a fixed window would roll over.
    for (let i = 0; i < 4; i++) assert.deepEqual(await quota.reserve(), { allowed: true });
    now += 59_000;
    assert.deepEqual(await quota.reserve(), { allowed: true });

    // Regression: a fixed window would let five more through here. The log
    // refuses until the first four are a full window old.
    now += 1_500;
    const refused = await quota.reserve();
    assert.equal(refused.allowed, false);
    assert.equal(refused.allowed === false && refused.retryAfterMs, 1_000_000 + windowMs - now);

    now = 1_000_000 + windowMs + 1;
    for (let i = 0; i < 4; i++) assert.deepEqual(await quota.reserve(), { allowed: true });
    assert.equal((await quota.reserve()).allowed, false, "the fifth call is still in the window");
}

/** A tiny in-memory stand-in for the sorted-set commands, run in order like a Redis transaction. */
function fakeRedis(options: { failing?: boolean } = {}) {
    const sets = new Map<string, Map<string, number>>();
    const commands: string[] = [];
    const set = (name: string) => {
        if (!sets.has(name)) sets.set(name, new Map());
        return sets.get(name)!;
    };
    const redis = {
        multi() {
            const queue: Array<() => unknown> = [];
            const pipeline = {
                zremrangebyscore(name: string, min: number, max: number) {
                    queue.push(() => {
                        let removed = 0;
                        for (const [member, score] of set(name)) {
                            if (score >= min && score <= max) {
                                set(name).delete(member);
                                removed++;
                            }
                        }
                        return removed;
                    });
                    return pipeline;
                },
                zadd(name: string, { score, member }: { score: number; member: string }) {
                    queue.push(() => (set(name).set(member, score), 1));
                    return pipeline;
                },
                zcard(name: string) {
                    queue.push(() => set(name).size);
                    return pipeline;
                },
                zrange(name: string, start: number, stop: number, opts: { withScores?: boolean }) {
                    queue.push(() => {
                        assert.equal(opts.withScores, true);
                        const sorted = [...set(name)].sort((a, b) => a[1] - b[1]).slice(start, stop + 1);
                        return sorted.flatMap(([member, score]) => [member, String(score)]);
                    });
                    return pipeline;
                },
                pexpire(name: string, ms: number) {
                    queue.push(() => (assert.ok(ms > 0), 1));
                    return pipeline;
                },
                async exec() {
                    commands.push("exec");
                    if (options.failing) throw new Error("redis unreachable");
                    return queue.map((run) => run());
                },
            };
            return pipeline;
        },
        async zrem(name: string, member: string) {
            commands.push("zrem");
            return set(name).delete(member) ? 1 : 0;
        },
    };
    return { redis: redis as unknown as QuotaRedis, sets, commands };
}

describe("MASSIVE_QUOTA_KEY", () => {
    test("is one fixed log name, with nothing from the API key in it", () => {
        assert.equal(MASSIVE_QUOTA_KEY, "provider:massive");
    });
});

describe("memory quota store", () => {
    test("allows five calls in any rolling minute", () => checkRollingWindow((now) => createMemoryQuotaStore(now)));

    test("callers on the same log share one budget; another log has its own", async () => {
        const store = createMemoryQuotaStore(() => 0);
        const ingest = createProviderQuota(store, MASSIVE_QUOTA_KEY);
        const routes = createProviderQuota(store, MASSIVE_QUOTA_KEY);
        const other = createProviderQuota(store, "provider:other");
        for (let i = 0; i < 3; i++) await ingest.reserve();
        for (let i = 0; i < 2; i++) await routes.reserve();
        assert.equal((await ingest.reserve()).allowed, false);
        assert.equal((await routes.reserve()).allowed, false);
        assert.equal((await other.reserve()).allowed, true);
    });
});

describe("Redis quota store", () => {
    test("allows five calls in any rolling minute", () =>
        checkRollingWindow((now) => createRedisQuotaStore(fakeRedis().redis, { keyPrefix: "atlas:quota", now })));

    test("a refused call takes itself back out of the log", async () => {
        const { redis, sets, commands } = fakeRedis();
        const quota = createProviderQuota(createRedisQuotaStore(redis, { keyPrefix: "atlas:quota", now: () => 5_000_000 }), "provider:massive:k");
        for (let i = 0; i < 5; i++) await quota.reserve();
        assert.equal((await quota.reserve()).allowed, false);
        assert.equal(sets.get("atlas:quota:provider:massive:k")?.size, 5);
        assert.deepEqual(commands.filter((command) => command === "zrem"), ["zrem"]);
    });

    test("a Redis failure lets the call through", async () => {
        const original = console.warn;
        console.warn = () => {};
        try {
            const store = createRedisQuotaStore(fakeRedis({ failing: true }).redis, { keyPrefix: "atlas:quota" });
            assert.deepEqual(await store.reserve("k", MASSIVE_CALLS_PER_MINUTE), { allowed: true });
        } finally {
            console.warn = original;
        }
    });
});

describe("getMassiveQuota", () => {
    afterEach(() => setQuotaStoreForTests(null));

    test("uses the shared quota store", async () => {
        setQuotaStoreForTests(createMemoryQuotaStore(() => 0));
        for (let i = 0; i < 5; i++) await getMassiveQuota().reserve();
        assert.equal((await getMassiveQuota().reserve()).allowed, false);
    });
});
