/**
 * The jobs /api/cron/daily runs, in order, once each weekday evening after
 * the close (vercel.json). The quick cleanups go first so a long price
 * backfill can never crowd it out of the function's time limit. Linked
 * accounts sync next (launch item i44), within a budget of their own that
 * leaves the price job its 240 s, so tonight's prices and snapshots include
 * what they hold. Snapshots come after the prices they are valued at (they
 * use only stored closes, so they run, and stay quick, even when the price
 * job stopped early).
 */

import { pruneAskHistory } from "@/lib/ask/server/history";
import { ingestDailyPrices } from "@/lib/markets/price-ingest";
import { syncAllPlaidItems } from "@/lib/plaid/sync";
import { recordValuationSnapshots } from "@/lib/portfolio/valuation-snapshots";

import { deleteExpiredSessions } from "./expired-sessions";
import type { ScheduledJob } from "./runner";

export const DAILY_JOBS: readonly ScheduledJob[] = [
    { name: "expired-sessions", run: () => deleteExpiredSessions() },
    { name: "ask-history", run: () => pruneAskHistory() },
    { name: "plaid", run: () => syncAllPlaidItems() },
    { name: "prices", run: () => ingestDailyPrices() },
    { name: "snapshots", run: () => recordValuationSnapshots() },
];
