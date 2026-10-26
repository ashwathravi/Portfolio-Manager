import { Suspense } from 'react';
import { AllocationCard, type AllocationHolding } from '@/components/dashboard/AllocationCard';
import { TopHoldingsCard, type TopHoldingsRow } from '@/components/dashboard/TopHoldingsCard';
import { RecentActivityCard } from '@/components/dashboard/RecentActivityCard';
import { WatchlistCard } from '@/components/dashboard/WatchlistCard';
import { PatternFeed } from '@/components/dashboard/PatternFeed';
import { WeeklyReviewCard } from '@/components/dashboard/WeeklyReviewCard';
import { AlphaRadarDashboardCard } from '@/components/dashboard/AlphaRadarDashboardCard';
import { SampleDataNotice } from '@/components/data-display/SampleDataNotice';
import { SampleGate } from '@/components/data-display/SampleGate';
import { TodayHeader } from '@/components/today/TodayHeader';
import { TodayHero, type TodayHeroHolding } from '@/components/today/TodayHero';
import { TodayTriage } from '@/components/today/TodayTriage';
import { PolicyStrip } from '@/components/today/PolicyStrip';
import { TodayTheses } from '@/components/today/TodayTheses';
import { TodayEquityCurve } from '@/components/today/TodayEquityCurve';
import { evaluateRiskPolicy } from '@/lib/risk-policy';
import { buildPolicyPortfolio, valueHolding } from '@/lib/risk-policy/portfolio';
import { loadPolicyTheses, loadUserRiskPolicy } from '@/lib/risk-policy/server';
import type { SellDisciplineThesis } from '@/lib/risk-policy/sell-discipline';
import { loadDashboardPortfolios } from '@/lib/dashboard-portfolios';
import { DataUnavailableNotice } from '@/components/data-display/DataUnavailableNotice';
import { requirePageUserId } from '@/lib/auth/request-user';
import { loadQuotes } from '@/lib/services/market-data-service';
import { buildDashboardPortfoliosQuery, buildUserTransactionsQuery } from '@/lib/portfolio-repository';
import { toActivityRows, type TransactionRowInput } from '@/lib/portfolio/activity';
import { toTodayActivity } from '@/lib/today/rows';
import { getSecurityProfiles } from '@/lib/markets/price-store';
import { holdingName, loadSecurityProfiles } from '@/lib/markets/security-profile';
import { isDatabaseConfigured } from '@/db/connection-options';

/**
 * Today (/).
 *
 * Ordered by what the user needs first:
 *   1. Money — net worth and today's change from their own holdings.
 *   2. Needs your attention — policy breaches, theses due for review, the
 *      weekly review. Each row links to where it gets resolved.
 *   3. A one-line risk-policy strip (full checks behind a disclosure).
 *   4. The equity curve from nightly valuations, holdings, allocation, and
 *      recent activity — all from the database.
 *   5. Review & research — example-data cards, labelled and hideable.
 *
 * Every figure in 1–4 comes from the user's portfolios and transactions;
 * the risk policy is the user's saved one, evaluated on their holdings,
 * cash, trades and the theses they wrote (launch item i52), as Trade and
 * the Settings previews evaluate it (no example data mixed in).
 */

export const dynamic = 'force-dynamic';

export default async function Today() {
  const userId = await requirePageUserId();
  const { portfolios: allPortfolios, unavailable } = await loadDashboardPortfolios(userId, buildDashboardPortfoliosQuery);
  if (unavailable) {
    return (
      <div className="pm-dashboard-stack p-6">
        <TodayHeader />
        <DataUnavailableNotice />
      </div>
    );
  }

  let transactionRows: TransactionRowInput[] = [];
  try {
    transactionRows = await buildUserTransactionsQuery(userId);
  } catch (e) {
    console.warn('Today: transactions fetch failed — showing no recent activity.', e);
  }
  const activity = toActivityRows(transactionRows);

  // Warm quotes for the first paint; the hero keeps polling client-side.
  // Without market data the stored prices stand.
  const heldSymbols = allPortfolios.flatMap((p) => p.holdings.map((h) => h.symbol));
  const [liveQuotes, profiles, theses, riskPolicy] = await Promise.all([
    loadQuotes(heldSymbols),
    // Company names from the securities master (launch item i34).
    loadSecurityProfiles(heldSymbols, getSecurityProfiles),
    // The theses the user wrote, for the sell rules; none without a database.
    isDatabaseConfigured()
      ? loadPolicyTheses(userId).catch((e): SellDisciplineThesis[] => {
        console.warn('Today: theses fetch failed — the sell rules see none.', e);
        return [];
      })
      : [],
    loadUserRiskPolicy(userId),
  ]);

  const cashTotal = allPortfolios.reduce((s, p) => s + (p.cashBalance || 0), 0);
  const allHoldings = allPortfolios.flatMap((p) =>
    p.holdings.map((h) => ({
      id: h.id,
      portfolio: p.name,
      symbol: h.symbol,
      name: holdingName(h.symbol, h.name, profiles.get(h.symbol.toUpperCase())),
      ...valueHolding(h, liveQuotes[h.symbol.toUpperCase()]?.price),
    })),
  );

  const heroHoldings: TodayHeroHolding[] = allHoldings
    .filter((h) => h.symbol)
    .map(({ symbol, quantity, currentPrice, marketValue }) => ({ symbol, quantity, currentPrice, marketValue }));

  const allocationHoldings: AllocationHolding[] = allHoldings.map((h) => ({
    symbol: h.symbol,
    portfolio: h.portfolio,
    marketValue: h.marketValue,
  }));
  const cashByPortfolio = Object.fromEntries(allPortfolios.map((p) => [p.name, p.cashBalance || 0]));
  const topHoldingsRows: TopHoldingsRow[] = allHoldings.map((h) => ({
    id: h.id,
    symbol: h.symbol,
    name: h.name,
    quantity: h.quantity,
    avgCost: h.avgCost,
    currentPrice: h.currentPrice,
    marketValue: h.marketValue,
  }));

  // The user's saved policy on their own portfolio, as every view evaluates it.
  const policyPortfolio = buildPolicyPortfolio({
    accounts: allPortfolios,
    quotes: liveQuotes,
    profiles,
    activity,
    theses,
    asOf: new Date(),
  });
  const riskPolicySummary = evaluateRiskPolicy(policyPortfolio, riskPolicy);

  return (
    <div className="pm-dashboard-stack p-6">
      <TodayHeader />

      <div className="pm-today-top">
        <TodayHero
          holdings={heroHoldings}
          cashTotal={cashTotal}
          accounts={allPortfolios.map((p) => ({ id: p.id, name: p.name }))}
        />
        {/* Policy checks only mean something once there are holdings to check. */}
        <TodayTriage policyActions={allHoldings.length > 0 ? riskPolicySummary.nextActions : []} />
      </div>

      {allHoldings.length > 0 && <PolicyStrip summary={riskPolicySummary} portfolio={policyPortfolio} />}

      <Suspense fallback={null}>
        <TodayEquityCurve userId={userId} />
      </Suspense>

      {allHoldings.length > 0 && (
        <div className="pm-grid-2-63">
          <TopHoldingsCard rows={topHoldingsRows} limit={6} />
          <AllocationCard holdings={allocationHoldings} cashByPortfolio={cashByPortfolio} />
        </div>
      )}

      <div className="pm-grid-2-63">
        <RecentActivityCard activities={toTodayActivity(activity)} limit={8} />
        <WatchlistCard limit={6} />
      </div>

      <SampleGate>
        <section className="pm-today-examples" aria-labelledby="pm-today-examples-head" data-testid="today-examples">
          <header className="pm-today-section-head">
            <h2 id="pm-today-examples-head" className="pm-today-section-title">Review &amp; research</h2>
            <SampleDataNotice>
              The weekly review, patterns, theses, and Alpha Radar below use example data.
            </SampleDataNotice>
          </header>
          <div id="weekly-review">
            <WeeklyReviewCard />
          </div>
          <div className="pm-grid-2-63">
            <PatternFeed />
            <TodayTheses limit={4} />
          </div>
          <AlphaRadarDashboardCard />
        </section>
      </SampleGate>
    </div>
  );
}

