/**
 * The jobs /api/cron/daily runs, in order, once each weekday evening after
 * the close (vercel.json). The quick cleanup goes first so a long price
 * backfill can never crowd it out of the function's time limit. Snapshots
 * come after the prices they are valued at (they use only stored closes, so
 * they run, and stay quick, even when the price job stopped early).
 */

import { ingestDailyPrices } from "@/lib/markets/price-ingest";
import { recordValuationSnapshots } from "@/lib/portfolio/valuation-snapshots";

import { deleteExpiredSessions } from "./expired-sessions";
import type { ScheduledJob } from "./runner";

export const DAILY_JOBS: readonly ScheduledJob[] = [
    { name: "expired-sessions", run: () => deleteExpiredSessions() },
    { name: "prices", run: () => ingestDailyPrices() },
    { name: "snapshots", run: () => recordValuationSnapshots() },
];
