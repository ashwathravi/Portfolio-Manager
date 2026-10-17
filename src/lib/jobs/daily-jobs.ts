/**
 * The jobs /api/cron/daily runs, in order, once each weekday evening after
 * the close (vercel.json). The quick cleanup goes first so a long price
 * backfill can never crowd it out of the function's time limit.
 */

import { ingestDailyPrices } from "@/lib/markets/price-ingest";

import { deleteExpiredSessions } from "./expired-sessions";
import type { ScheduledJob } from "./runner";

export const DAILY_JOBS: readonly ScheduledJob[] = [
    { name: "expired-sessions", run: () => deleteExpiredSessions() },
    { name: "prices", run: () => ingestDailyPrices() },
];
