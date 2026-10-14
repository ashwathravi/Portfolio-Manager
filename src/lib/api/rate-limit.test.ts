import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Redis } from "@upstash/redis";

import {
    clientIpAddress,
    createMemoryRateLimitStore,
    createUpstashRateLimitStore,
    rateLimitKeyPrefix,
    rateLimitRouteKey,
    resolveRateLimitStore,
    resolveUpstashCredentials,
} from "./rate-limit.ts";

const MINUTE = { limit: 2, windowSeconds: 60 };

describe("rateLimitRouteKey", () => {
    test("collapses UUIDs, numeric ids and long tokens", () => {
        assert.equal(
            rateLimitRouteKey("/api/portfolio/00000000-0000-4000-8000-000000000001/value"),
            "/api/portfolio/:id/value",
        );
        assert.equal(rateLimitRouteKey("/api/alpha-radar/filers/1067983/refresh"), "/api/alpha-radar/filers/:id/refresh");
        assert.equal(rateLimitRouteKey("/api/things/abcdefghijklmnopqrstuvwxyz"), "/api/things/:id");
    });

    test("keeps ordinary route words", () => {
        assert.equal(rateLimitRouteKey("/api/market-data/search"), "/api/market-data/search");
        assert.equal(rateLimitRouteKey("/api/auth/callback/google"), "/api/auth/callback/google");
    });
});

describe("clientIpAddress", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.5, 10.0.0.1" });

    test("uses the platform-set x-real-ip on Vercel", () => {
        assert.equal(clientIpAddress(headers, { VERCEL: "1" }), "198.51.100.1");
    });

    test("uses the first forwarded hop elsewhere", () => {
        assert.equal(clientIpAddress(headers, {}), "203.0.113.5");
    });

    test("falls back to a shared unknown bucket", () => {
        assert.equal(clientIpAddress(new Headers(), {}), "unknown");
        assert.equal(clientIpAddress(new Headers(), { VERCEL: "1" }), "unknown");
    });
});

describe("createMemoryRateLimitStore", () => {
    test("allows up to the limit, then reports when to retry", async () => {
        let clock = 0;
        const store = createMemoryRateLimitStore(() => clock);

        assert.equal((await store.consume("k", MINUTE)).allowed, true);
        assert.equal((await store.consume("k", MINUTE)).allowed, true);
        clock = 15_000;
        assert.deepEqual(await store.consume("k", MINUTE), { allowed: false, retryAfterSeconds: 45 });
    });

    test("starts a new window when the old one ends, and keys are independent", async () => {
        let clock = 0;
        const store = createMemoryRateLimitStore(() => clock);
        await store.consume("k", MINUTE);
        await store.consume("k", MINUTE);

        assert.equal((await store.consume("other", MINUTE)).allowed, true);
        clock = 60_000;
        assert.equal((await store.consume("k", MINUTE)).allowed, true);
    });
});

describe("createUpstashRateLimitStore", () => {
    const redis = new Redis({ url: "https://example.upstash.io", token: "unused" });

    test("maps the limiter's answer and reset time", async () => {
        const store = createUpstashRateLimitStore(redis, {
            keyPrefix: "atlas:rl:test",
            now: () => 10_000,
            createLimiter: () => ({
                limit: async (identifier: string) => ({ success: identifier !== "blocked", reset: 40_500 }),
            }),
        });

        assert.deepEqual(await store.consume("ok", MINUTE), { allowed: true, retryAfterSeconds: 0 });
        assert.deepEqual(await store.consume("blocked", MINUTE), { allowed: false, retryAfterSeconds: 31 });
    });

    test("lets the request through when Redis fails", async (t) => {
        t.mock.method(console, "warn", () => {});
        const store = createUpstashRateLimitStore(redis, {
            keyPrefix: "atlas:rl:test",
            createLimiter: () => ({
                limit: async () => {
                    throw new Error("WRONGPASS invalid or missing auth token");
                },
            }),
        });

        assert.deepEqual(await store.consume("k", MINUTE), { allowed: true, retryAfterSeconds: 0 });
    });

    test("creates one limiter per rule, prefixed by environment and rule", async () => {
        const prefixes: string[] = [];
        const store = createUpstashRateLimitStore(redis, {
            keyPrefix: "atlas:rl:production",
            createLimiter: (_rule, prefix) => {
                prefixes.push(prefix);
                return { limit: async () => ({ success: true, reset: 0 }) };
            },
        });

        await store.consume("a", MINUTE);
        await store.consume("b", MINUTE);
        await store.consume("c", { limit: 30, windowSeconds: 60 });

        assert.deepEqual(prefixes, ["atlas:rl:production:2-per-60s", "atlas:rl:production:30-per-60s"]);
    });
});

describe("resolveRateLimitStore", () => {
    test("uses Upstash when the Marketplace credentials are present", () => {
        const store = resolveRateLimitStore({
            KV_REST_API_URL: "https://example.upstash.io",
            KV_REST_API_TOKEN: "token",
            VERCEL_ENV: "preview",
        });
        assert.equal(store.kind, "upstash");
    });

    test("falls back to memory without credentials", (t) => {
        t.mock.method(console, "warn", () => {});
        assert.equal(resolveRateLimitStore({}).kind, "memory");
        assert.equal(resolveRateLimitStore({ NODE_ENV: "production", KV_REST_API_URL: "https://x.upstash.io" }).kind, "memory");
    });
});

describe("resolveUpstashCredentials", () => {
    test("prefers the complete Marketplace pair", () => {
        assert.deepEqual(resolveUpstashCredentials({
            KV_REST_API_URL: "https://kv.upstash.io",
            KV_REST_API_TOKEN: "kv-token",
            UPSTASH_REDIS_REST_URL: "https://other.upstash.io",
            UPSTASH_REDIS_REST_TOKEN: "other-token",
        }), { url: "https://kv.upstash.io", token: "kv-token" });
    });

    test("never mixes a URL from one pair with the token from the other", () => {
        assert.deepEqual(resolveUpstashCredentials({
            KV_REST_API_URL: "https://kv.upstash.io",
            UPSTASH_REDIS_REST_URL: "https://other.upstash.io",
            UPSTASH_REDIS_REST_TOKEN: "other-token",
        }), { url: "https://other.upstash.io", token: "other-token" });
        assert.equal(resolveUpstashCredentials({
            KV_REST_API_URL: "https://kv.upstash.io",
            UPSTASH_REDIS_REST_TOKEN: "other-token",
        }), null);
    });
});

describe("rateLimitKeyPrefix", () => {
    test("one namespace for production and one for local runs", () => {
        assert.equal(rateLimitKeyPrefix({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "master" }), "atlas:rl:production");
        assert.equal(rateLimitKeyPrefix({}), "atlas:rl:local");
    });

    test("a namespace per preview branch", () => {
        assert.equal(
            rateLimitKeyPrefix({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/Phase-1 rate limiting" }),
            "atlas:rl:preview:feat-phase-1-rate-limiting",
        );
        assert.notEqual(
            rateLimitKeyPrefix({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "a" }),
            rateLimitKeyPrefix({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "b" }),
        );
        assert.equal(rateLimitKeyPrefix({ VERCEL_ENV: "preview" }), "atlas:rl:preview:unknown");
    });
});
