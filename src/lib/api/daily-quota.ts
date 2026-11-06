import type { NextResponse } from "next/server";

import { getRateLimitStore, type RateLimitStore } from "@/lib/api/rate-limit";
import { apiError } from "@/lib/api/security";

/**
 * Daily per-user quotas (launch item i77) on what costs Atlas more than a
 * request: CSV imports write up to a few thousand rows, Plaid charges for
 * the connections a bank link makes and is called on every sync, and a
 * backtest reads two years of daily bars. The per-minute rate limits stop a
 * burst; these stop a steady drip that would stay under them all day. Ask
 * has its own limit, kept with the conversation (src/lib/ask/server/history.ts).
 *
 * Counted in the rate limiter's store, in one-day fixed windows: with
 * Upstash (every deployed environment) a day is a UTC day, shared by every
 * instance, and a Redis outage lets the request through, as the rate limits
 * do. API_RATE_LIMIT_DISABLED turns these off too.
 */
export const DAILY_QUOTAS = {
    imports: { limit: 20, reached: "You can import up to 20 CSV files a day." },
    bankLinks: { limit: 10, reached: "You can open bank linking up to 10 times a day." },
    bankSyncs: { limit: 20, reached: "You can sync your linked accounts up to 20 times a day. They still sync every night." },
    backtests: { limit: 100, reached: "You can run up to 100 backtests a day." },
} as const satisfies Record<string, { limit: number; reached: string }>;

export type DailyQuota = keyof typeof DAILY_QUOTAS;

export const DAILY_QUOTA_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Takes one of the user's daily `quota`, or answers 429 DAILY_QUOTA_REACHED
 * with how long until the next day's starts. Call it once the request is
 * well formed and just before the work, so a malformed one costs nothing.
 */
export async function consumeDailyQuota(
    userId: string,
    quota: DailyQuota,
    store: RateLimitStore = getRateLimitStore(),
): Promise<NextResponse | undefined> {
    if (process.env.API_RATE_LIMIT_DISABLED === "1") return undefined;

    const { limit, reached } = DAILY_QUOTAS[quota];
    const decision = await store.consume(`quota:${quota}:${userId}`, { limit, windowSeconds: DAILY_QUOTA_WINDOW_SECONDS });
    if (decision.allowed) return undefined;

    const retryAfterSeconds = Math.max(1, decision.retryAfterSeconds);
    return apiError(
        `${reached} Try again in ${describeWait(retryAfterSeconds)}.`,
        "DAILY_QUOTA_REACHED",
        429,
        { headers: { "Retry-After": String(retryAfterSeconds) } },
    );
}

/** "about 5 hours", "about an hour", "12 minutes", "a minute". */
export function describeWait(seconds: number): string {
    const minutes = Math.ceil(seconds / 60);
    if (minutes <= 1) return "a minute";
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.round(minutes / 60);
    return hours === 1 ? "about an hour" : `about ${hours} hours`;
}
