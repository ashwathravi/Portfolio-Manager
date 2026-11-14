/**
 * New accounts while sign-up is open (launch item i77). With an invite list
 * the list decides who joins. With AUTH_OPEN_SIGNUP, at most
 * AUTH_SIGNUP_DAILY_LIMIT accounts are made a day (50 unless set), so a wave
 * of sign-ups can't run through the hosting, database and Plaid allowances
 * before the owner notices. Someone who already has an account always
 * signs in.
 *
 * Counted in the rate limiter's store, like the daily quotas
 * (src/lib/api/daily-quota.ts): with Upstash, a UTC day shared by every
 * instance.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { authAccounts } from "@/db/schema";
import { getRateLimitStore, type RateLimitStore } from "@/lib/api/rate-limit";
import type { AuthEnvironment } from "@/lib/auth/access";

export const DEFAULT_SIGNUP_DAILY_LIMIT = 50;
/** The login page's `?error=` for someone turned away by the day's limit. */
export const SIGNUP_LIMIT_ERROR = "SignupLimit";

const DAY_SECONDS = 24 * 60 * 60;

export function signupDailyLimit(env: AuthEnvironment = process.env): number {
    const raw = env.AUTH_SIGNUP_DAILY_LIMIT?.trim();
    const limit = raw ? Number(raw) : Number.NaN;
    return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_SIGNUP_DAILY_LIMIT;
}

/** Takes one of the day's new accounts, if any are left. */
export async function admitNewAccount(
    store: RateLimitStore = getRateLimitStore(),
    env: AuthEnvironment = process.env,
): Promise<boolean> {
    const decision = await store.consume("signup:new-accounts", { limit: signupDailyLimit(env), windowSeconds: DAY_SECONDS });
    return decision.allowed;
}

/** Whether this Google account has signed in to Atlas before. */
export async function hasGoogleAccount(providerAccountId: string, database: Pick<typeof db, "select"> = db): Promise<boolean> {
    const [row] = await database
        .select({ userId: authAccounts.userId })
        .from(authAccounts)
        .where(and(eq(authAccounts.provider, "google"), eq(authAccounts.providerAccountId, providerAccountId)))
        .limit(1);
    return Boolean(row);
}

/**
 * The sign-in callback's answer: true to sign in, false to refuse (Auth.js
 * shows AccessDenied), or the login page saying the day's new accounts are
 * taken. Only a new account under open sign-up spends one.
 */
export async function signInDecision(
    { allowed, openSignup }: { allowed: boolean; openSignup: boolean },
    {
        isExistingAccount,
        admit,
    }: { isExistingAccount: () => Promise<boolean>; admit: () => Promise<boolean> },
): Promise<boolean | string> {
    if (!allowed) return false;
    if (!openSignup) return true;
    if (await isExistingAccount()) return true;
    return (await admit()) ? true : `/login?error=${SIGNUP_LIMIT_ERROR}`;
}
