/**
 * The jobs /api/cron/daily runs, in order, once each weekday evening after
 * the close (vercel.json). The quick cleanups go first so a long price
 * backfill can never crowd it out of the function's time limit. Linked
 * accounts sync next (launch item i44), within a budget of their own that
 * leaves the price job its 240 s, so tonight's prices and snapshots include
 * what they hold. Snapshots come after the prices they are valued at (they
 * use only stored closes, so they run, and stay quick, even when the price
 * job stopped early). The price job first refreshes the ticker search's
 * symbol directory from SEC (launch item i35): one quick request, taken out
 * of the price budget, and run even before a market data key is set.
 * Alerts go last, on the closes and holdings the jobs before them stored
 * (launch item i57).
 */

import { evaluateAlertRules } from "@/lib/alerts/nightly";
import { pruneAskHistory } from "@/lib/ask/server/history";
import { DEFAULT_BUDGET_MS, ingestDailyPrices } from "@/lib/markets/price-ingest";
import { refreshSymbolDirectory } from "@/lib/markets/symbol-directory";
import { syncAllPlaidItems } from "@/lib/plaid/sync";
import { recordValuationSnapshots } from "@/lib/portfolio/valuation-snapshots";

import { deleteExpiredSessions } from "./expired-sessions";
import type { JobDetail, ScheduledJob } from "./runner";

/** The symbol directory, then prices within what's left of the price budget. */
export async function refreshMarketData({
    directory = () => refreshSymbolDirectory(),
    prices = ingestDailyPrices,
    now = () => Date.now(),
}: {
    directory?: () => ReturnType<typeof refreshSymbolDirectory>;
    prices?: typeof ingestDailyPrices;
    now?: () => number;
} = {}): Promise<JobDetail> {
    const started = now();
    const symbolDirectory = await directory();
    const detail = await prices({ budgetMs: DEFAULT_BUDGET_MS - (now() - started) });
    return { ...detail, symbolDirectory };
}

export const DAILY_JOBS: readonly ScheduledJob[] = [
    { name: "expired-sessions", run: () => deleteExpiredSessions() },
    { name: "ask-history", run: () => pruneAskHistory() },
    { name: "plaid", run: () => syncAllPlaidItems() },
    { name: "prices", run: () => refreshMarketData() },
    { name: "snapshots", run: () => recordValuationSnapshots() },
    { name: "alerts", run: async () => ({ ...(await evaluateAlertRules()) }) },
];
