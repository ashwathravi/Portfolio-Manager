import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimitRule {
    limit: number;
    windowSeconds: number;
}

export interface RateLimitDecision {
    allowed: boolean;
    retryAfterSeconds: number;
}

export interface RateLimitStore {
    readonly kind: "memory" | "upstash";
    consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

type RateLimitEnvironment = Partial<Record<
    "KV_REST_API_URL" | "KV_REST_API_TOKEN" | "UPSTASH_REDIS_REST_URL" | "UPSTASH_REDIS_REST_TOKEN"
    | "VERCEL" | "VERCEL_ENV" | "NODE_ENV",
    string
>>;

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

// UUIDs, numeric ids (CIKs) and long opaque tokens. Collapsing them makes
// /api/portfolio/<id>/value one bucket instead of one bucket per portfolio.
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[A-Za-z0-9_-]{20,})$/i;

export function rateLimitRouteKey(pathname: string): string {
    return pathname
        .split("/")
        .map((segment) => (ID_SEGMENT.test(segment) ? ":id" : segment))
        .join("/");
}

/**
 * The client's IP address. On Vercel, x-real-ip is set by the platform from
 * the connection and can't be forged by the client. Elsewhere (local, the
 * Docker image) the first x-forwarded-for hop is only trustworthy behind a
 * proxy that overwrites it.
 */
export function clientIpAddress(headers: Headers, env: RateLimitEnvironment = process.env): string {
    const realIp = headers.get("x-real-ip")?.trim();
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (env.VERCEL === "1") return realIp || forwarded || "unknown";
    return forwarded || realIp || "unknown";
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/** Per-process fixed windows: local development, tests, and the fallback. */
export function createMemoryRateLimitStore(now: () => number = () => Date.now()): RateLimitStore & { reset(): void } {
    const buckets = new Map<string, { count: number; resetAt: number }>();
    let nextSweepAt = 0;

    return {
        kind: "memory",
        async consume(key, rule) {
            const current = now();
            if (current >= nextSweepAt) {
                nextSweepAt = current + 60_000;
                for (const [bucketKey, bucket] of buckets) {
                    if (bucket.resetAt <= current) buckets.delete(bucketKey);
                }
            }

            const existing = buckets.get(key);
            if (!existing || existing.resetAt <= current) {
                buckets.set(key, { count: 1, resetAt: current + rule.windowSeconds * 1000 });
                return { allowed: true, retryAfterSeconds: 0 };
            }
            if (existing.count >= rule.limit) {
                return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - current) / 1000)) };
            }
            existing.count += 1;
            return { allowed: true, retryAfterSeconds: 0 };
        },
        reset() {
            buckets.clear();
            nextSweepAt = 0;
        },
    };
}

interface WindowLimiter {
    limit(identifier: string): Promise<{ success: boolean; reset: number }>;
}

/**
 * Fixed windows in Upstash Redis, shared by every instance and region. Fixed
 * windows are the cheapest Upstash algorithm (two Redis commands per check);
 * the trade-off is that a client can get up to twice the limit in a burst
 * that straddles a window boundary, which is fine for abuse protection.
 * A slow or unreachable Redis lets the request through after one second
 * rather than taking the app down with it.
 */
export function createUpstashRateLimitStore(
    redis: Redis,
    {
        keyPrefix,
        createLimiter = (rule, prefix) => new Ratelimit({
            redis,
            limiter: Ratelimit.fixedWindow(rule.limit, `${rule.windowSeconds} s`),
            prefix,
            timeout: 1_000,
            analytics: false,
        }),
        now = () => Date.now(),
    }: {
        keyPrefix: string;
        createLimiter?: (rule: RateLimitRule, prefix: string) => WindowLimiter;
        now?: () => number;
    },
): RateLimitStore {
    const limiters = new Map<string, WindowLimiter>();

    return {
        kind: "upstash",
        async consume(key, rule) {
            const ruleId = `${rule.limit}-per-${rule.windowSeconds}s`;
            let limiter = limiters.get(ruleId);
            if (!limiter) {
                limiter = createLimiter(rule, `${keyPrefix}:${ruleId}`);
                limiters.set(ruleId, limiter);
            }
            const result = await limiter.limit(key);
            return {
                allowed: result.success,
                retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - now()) / 1000)),
            };
        },
    };
}

/**
 * Upstash when its REST credentials are present (Vercel's Marketplace sets
 * KV_REST_API_URL and KV_REST_API_TOKEN), otherwise per-process memory.
 * Keys are prefixed with the deployment environment, so local development
 * and previews never spend production's budget.
 */
export function resolveRateLimitStore(env: RateLimitEnvironment = process.env): RateLimitStore {
    const url = env.KV_REST_API_URL?.trim() || env.UPSTASH_REDIS_REST_URL?.trim();
    const token = env.KV_REST_API_TOKEN?.trim() || env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
        if (env.NODE_ENV === "production") {
            console.warn("Rate limiting is per-instance: set KV_REST_API_URL and KV_REST_API_TOKEN to share limits.");
        }
        return createMemoryRateLimitStore();
    }

    const environment = env.VERCEL_ENV?.trim() || "local";
    return createUpstashRateLimitStore(new Redis({ url, token }), { keyPrefix: `atlas:rl:${environment}` });
}

let activeStore: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
    activeStore ??= resolveRateLimitStore();
    return activeStore;
}

/** Tests: swap in a store, or pass null to resolve from the environment again. */
export function setRateLimitStoreForTests(store: RateLimitStore | null): void {
    activeStore = store;
}
