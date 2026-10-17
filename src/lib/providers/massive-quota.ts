/**
 * One Massive call budget shared by every caller (launch item i32).
 *
 * The free Basic plan allows 5 calls a minute per API key, but calls come
 * from many places: the nightly ingest, and history, fundamentals and search
 * requests on any number of server instances. Each Massive request first
 * takes a slot from this quota, so together they stay under the plan's limit.
 *
 * The quota is a sliding log: a call is allowed only while fewer than five
 * were allowed in the last minute (plus a second of slack for clock
 * differences between instances). Fixed windows would let ten through
 * across a window boundary. In production the log is a Redis sorted set in
 * Upstash, shared by every instance; without Redis it is per process. A
 * Redis failure lets the call through, and Massive's own 429 is the
 * backstop.
 *
 * The log is named after a hash of the API key, not the deployment: a
 * preview and production that share a key share its budget.
 */

import { createHash, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { resolveUpstashCredentials } from "@/lib/api/rate-limit";

export interface QuotaRule {
    limit: number;
    windowMs: number;
}

/** The free Basic plan's limit, with a second of slack for clock differences. */
export const MASSIVE_CALLS_PER_MINUTE: QuotaRule = { limit: 5, windowMs: 61_000 };

export type QuotaDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export interface ProviderQuota {
    /** Takes one call from the budget, or says how long until one is free. */
    reserve(): Promise<QuotaDecision>;
}

/** Where the call logs live. */
export interface QuotaStore {
    reserve(key: string, rule: QuotaRule): Promise<QuotaDecision>;
}

/** The quota's log: the API key's hash, never the key itself. */
export function massiveQuotaKey(apiKey: string): string {
    return `provider:massive:${createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 16)}`;
}

/** Per-process logs: local development, tests, and no Redis. */
export function createMemoryQuotaStore(now: () => number = () => Date.now()): QuotaStore {
    const logs = new Map<string, number[]>();
    return {
        async reserve(key, { limit, windowMs }) {
            const at = now();
            const log = (logs.get(key) ?? []).filter((time) => time > at - windowMs);
            if (log.length >= limit) {
                logs.set(key, log);
                return { allowed: false, retryAfterMs: Math.max(1, log[0] + windowMs - at) };
            }
            log.push(at);
            logs.set(key, log);
            return { allowed: true };
        },
    };
}

/** The Redis commands the shared log uses. */
export type QuotaRedis = Pick<Redis, "multi" | "zrem">;

/**
 * A sorted set per key, scored by time. One transaction drops entries older
 * than the window, adds this call, and reads the count and the oldest entry;
 * a call that made the count go over the limit removes itself. Transactions
 * run one at a time, so no more than `limit` calls are ever admitted within
 * a window (a burst of concurrent calls can only be refused too often, never
 * allowed too often).
 */
export function createRedisQuotaStore(
    redis: QuotaRedis,
    { keyPrefix, now = () => Date.now() }: { keyPrefix: string; now?: () => number },
): QuotaStore {
    return {
        async reserve(key, { limit, windowMs }) {
            const name = `${keyPrefix}:${key}`;
            const at = now();
            const member = `${at}:${randomUUID()}`;
            try {
                const [, , count, oldest] = (await redis
                    .multi()
                    .zremrangebyscore(name, 0, at - windowMs)
                    .zadd(name, { score: at, member })
                    .zcard(name)
                    .zrange(name, 0, 0, { withScores: true })
                    .pexpire(name, windowMs)
                    .exec()) as [number, number | null, number, unknown[], number];
                if (count <= limit) return { allowed: true };
                await redis.zrem(name, member);
                const oldestAt = Number(oldest?.[1]);
                return { allowed: false, retryAfterMs: Number.isFinite(oldestAt) ? Math.max(1, oldestAt + windowMs - at) : windowMs };
            } catch (error) {
                // Same as the API rate limiter: a Redis outage must not stop every call.
                console.warn("Provider quota check failed; allowing the call.", error);
                return { allowed: true };
            }
        },
    };
}

export function createProviderQuota(store: QuotaStore, key: string, rule: QuotaRule = MASSIVE_CALLS_PER_MINUTE): ProviderQuota {
    return { reserve: () => store.reserve(key, rule) };
}

let quotaStore: QuotaStore | null = null;

/** Upstash when configured (one namespace for every deployment), otherwise per process. */
function getQuotaStore(env: NodeJS.ProcessEnv = process.env): QuotaStore {
    if (!quotaStore) {
        const credentials = resolveUpstashCredentials(env);
        quotaStore = credentials
            ? createRedisQuotaStore(new Redis(credentials), { keyPrefix: "atlas:quota" })
            : createMemoryQuotaStore();
    }
    return quotaStore;
}

/** The shared quota for a Massive API key (default: POLYGON_API_KEY). */
export function getMassiveQuota(apiKey: string = process.env.POLYGON_API_KEY ?? ""): ProviderQuota {
    return createProviderQuota(getQuotaStore(), massiveQuotaKey(apiKey));
}

/** Tests: swap in a store, or pass null to resolve from the environment again. */
export function setQuotaStoreForTests(store: QuotaStore | null): void {
    quotaStore = store;
}
