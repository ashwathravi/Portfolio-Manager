/**
 * One Massive call budget shared by every caller (launch item i32).
 *
 * The free Basic plan allows 5 calls a minute per API key, but calls come
 * from many places: the nightly ingest, and history, fundamentals and search
 * requests on any number of server instances. Each Massive request first
 * takes a token from this quota, held in the shared rate-limit store (Upstash
 * Redis in production), so together they stay under the plan's limit.
 *
 * The bucket is named after a hash of the API key, not the deployment: a
 * preview and production that share a key share its budget. Without Redis
 * the quota is per process, and if Redis fails the call is let through;
 * Massive's own 429 is then the backstop.
 */

import { createHash } from "node:crypto";

import {
    createMemoryRateLimitStore,
    createUpstashRateLimitStore,
    resolveUpstashCredentials,
    type RateLimitRule,
    type RateLimitStore,
} from "@/lib/api/rate-limit";
import { Redis } from "@upstash/redis";

/** The free Basic plan's limit. */
export const MASSIVE_CALLS_PER_MINUTE: RateLimitRule = { limit: 5, windowSeconds: 60 };

export type QuotaDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

export interface ProviderQuota {
    /** Takes one call from the budget, or says how long until one is free. */
    reserve(): Promise<QuotaDecision>;
}

/** The quota's bucket: the API key's hash, never the key itself. */
export function massiveQuotaKey(apiKey: string): string {
    return `provider:massive:${createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 16)}`;
}

export function createProviderQuota(store: RateLimitStore, key: string, rule: RateLimitRule = MASSIVE_CALLS_PER_MINUTE): ProviderQuota {
    return {
        async reserve() {
            const decision = await store.consume(key, rule);
            return decision.allowed ? { allowed: true } : { allowed: false, retryAfterMs: decision.retryAfterSeconds * 1000 };
        },
    };
}

let quotaStore: RateLimitStore | null = null;

/**
 * Upstash with credentials (one namespace for every deployment, since the
 * budget belongs to the API key), otherwise per-process memory.
 */
function getQuotaStore(env: NodeJS.ProcessEnv = process.env): RateLimitStore {
    if (!quotaStore) {
        const credentials = resolveUpstashCredentials(env);
        quotaStore = credentials
            ? createUpstashRateLimitStore(new Redis(credentials), { keyPrefix: "atlas:quota" })
            : createMemoryRateLimitStore();
    }
    return quotaStore;
}

/** The shared quota for a Massive API key (default: POLYGON_API_KEY). */
export function getMassiveQuota(apiKey: string = process.env.POLYGON_API_KEY ?? ""): ProviderQuota {
    return createProviderQuota(getQuotaStore(), massiveQuotaKey(apiKey));
}

/** Tests: swap in a store, or pass null to resolve from the environment again. */
export function setQuotaStoreForTests(store: RateLimitStore | null): void {
    quotaStore = store;
}
