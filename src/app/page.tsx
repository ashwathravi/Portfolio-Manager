import { marketDataEngine } from '@/lib/api/market-data';
import { EquityChartCard } from '@/components/dashboard/EquityChartCard';
import { AllocationCard, type AllocationHolding } from '@/components/dashboard/AllocationCard';
import { TopHoldingsCard, type TopHoldingsRow } from '@/components/dashboard/TopHoldingsCard';
import { RecentActivityCard } from '@/components/dashboard/RecentActivityCard';
import { WatchlistCard } from '@/components/dashboard/WatchlistCard';
import { PatternFeed } from '@/components/dashboard/PatternFeed';
import { WeeklyReviewCard } from '@/components/dashboard/WeeklyReviewCard';
import { AlphaRadarDashboardCard } from '@/components/dashboard/AlphaRadarDashboardCard';
import type { RiskPolicyDashboardCardInput } from '@/components/dashboard/RiskPolicyDashboardCard';
import { SampleDataNotice } from '@/components/data-display/SampleDataNotice';
import { SampleGate } from '@/components/data-display/SampleGate';
import { TodayHeader } from '@/components/today/TodayHeader';
import { TodayHero, type TodayHeroHolding } from '@/components/today/TodayHero';
import { TodayTriage } from '@/components/today/TodayTriage';
import { PolicyStrip } from '@/components/today/PolicyStrip';
import { TodayTheses } from '@/components/today/TodayTheses';
import { computeRiskPolicyDashboard } from '@/lib/risk-policy';
import { loadDashboardPortfolios } from '@/lib/dashboard-portfolios';
import { requirePageUserId } from '@/lib/auth/request-user';
import { buildDashboardPortfoliosQuery, buildUserTransactionsQuery } from '@/lib/portfolio-repository';
import { toActivityRows, type TransactionRowInput } from '@/lib/portfolio/activity';
import { toTodayActivity } from '@/lib/today/rows';

/**
 * Today (/).
 *
 * Ordered by what the user needs first:
 *   1. Money — net worth and today's change from their own holdings.
 *   2. Needs your attention — policy breaches, theses due for review, the
 *      weekly review. Each row links to where it gets resolved.
 *   3. A one-line risk-policy strip (full checks behind a disclosure).
 *   4. Holdings, allocation, and recent activity — all from the database.
 *   5. Review & research — example-data cards, labelled and hideable.
 *
 * Every figure in 1–4 comes from the user's portfolios and transactions;
 * the risk policy is computed from real holdings, cash, and trades only
 * (no example option positions or theses mixed in).
 */

export const dynamic = 'force-dynamic';

export default async function Today() {
  const userId = await requirePageUserId();
  const allPortfolios = await loadDashboardPortfolios(userId, buildDashboardPortfoliosQuery);

  let transactionRows: TransactionRowInput[] = [];
  try {
    transactionRows = await buildUserTransactionsQuery(userId);
  } catch (e) {
    console.warn('Today: transactions fetch failed — showing no recent activity.', e);
  }
  const activity = toActivityRows(transactionRows);

  // Warm quotes for the first paint; the hero keeps polling client-side.
  let liveQuotes: Record<string, { price: number; change?: number; changePercent?: number }> = {};
  try {
    const symbols = Array.from(new Set(allPortfolios.flatMap((p) => p.holdings.map((h) => h.symbol)).filter(Boolean)));
    if (symbols.length > 0) liveQuotes = await marketDataEngine.getQuotes(symbols);
  } catch (e) {
    console.warn('Failed to fetch live quotes for Today', e);
  }

  const cashTotal = allPortfolios.reduce((s, p) => s + (p.cashBalance || 0), 0);
  const allHoldings = allPortfolios.flatMap((p) =>
    p.holdings.map((h) => {
      const quantity = Number(h.quantity) || 0;
      const currentPrice = Number(liveQuotes[h.symbol]?.price ?? h.currentPrice ?? 0);
      return {
        id: h.id,
        portfolio: p.name,
        symbol: h.symbol,
        quantity,
        avgCost: Number(h.avgCost) || 0,
        currentPrice,
        marketValue: Number(h.marketValue) || quantity * currentPrice,
      };
    }),
  );

  const heroHoldings: TodayHeroHolding[] = allHoldings
    .filter((h) => h.symbol)
    .map(({ symbol, quantity, currentPrice, marketValue }) => ({ symbol, quantity, currentPrice, marketValue }));
  const netWorth = cashTotal + allHoldings.reduce((sum, h) => sum + h.marketValue, 0);

  const allocationHoldings: AllocationHolding[] = allHoldings.map((h) => ({
    symbol: h.symbol,
    portfolio: h.portfolio,
    marketValue: h.marketValue,
  }));
  const cashByPortfolio = Object.fromEntries(allPortfolios.map((p) => [p.name, p.cashBalance || 0]));
  const topHoldingsRows: TopHoldingsRow[] = allHoldings.map((h) => ({
    id: h.id,
    symbol: h.symbol,
    name: resolveName(h.symbol),
    quantity: h.quantity,
    avgCost: h.avgCost,
    currentPrice: h.currentPrice,
    marketValue: h.marketValue,
  }));

  const riskPolicyInput: RiskPolicyDashboardCardInput = {
    holdings: allHoldings.map((h) => ({
      id: h.id,
      symbol: h.symbol,
      name: resolveName(h.symbol),
      quantity: h.quantity,
      avgCost: h.avgCost,
      currentPrice: h.currentPrice,
      marketValue: h.marketValue,
      isEmployerStock: h.symbol === 'GOOG' || h.symbol === 'GOOGL',
    })),
    cashTotal,
    trades: activity
      .filter((a) => a.side === 'BUY' || a.side === 'SELL')
      .map((a) => ({ id: a.id, date: a.date, type: a.side.toLowerCase(), ticker: a.symbol ?? undefined, quantity: a.quantity ?? undefined, amount: a.value })),
  };
  const riskPolicySummary = computeRiskPolicyDashboard(riskPolicyInput);

  return (
    <div className="pm-dashboard-stack p-6">
      <TodayHeader />

      <div className="pm-today-top">
        <TodayHero holdings={heroHoldings} cashTotal={cashTotal} />
        {/* Policy checks only mean something once there are holdings to check. */}
        <TodayTriage policyActions={allHoldings.length > 0 ? riskPolicySummary.nextActions : []} />
      </div>

      {allHoldings.length > 0 && <PolicyStrip summary={riskPolicySummary} input={riskPolicyInput} />}

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
              The weekly review, equity curve, patterns, theses, and Alpha Radar below use example data.
            </SampleDataNotice>
          </header>
          <div id="weekly-review">
            <WeeklyReviewCard />
          </div>
          <div className="pm-grid-2-63">
            <EquityChartCard netWorth={netWorth || 250_000} seed={allHoldings.length} />
            <TodayTheses limit={4} />
          </div>
          <div className="pm-grid-2-63">
            <PatternFeed />
            <AlphaRadarDashboardCard />
          </div>
        </section>
      </SampleGate>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static lookups
// ---------------------------------------------------------------------------

/**
 * Rough ticker → company name map. Used by the Top Holdings card when the
 * backend doesn't supply a name. Keep it small; anything not in the map
 * falls back to the ticker itself (still readable).
 */
const TICKER_NAMES: Record<string, string> = {
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corp.',
  NVDA: 'NVIDIA Corp.',
  GOOG: 'Alphabet Inc. (Class C)',
  GOOGL: 'Alphabet Inc. (Class A)',
  META: 'Meta Platforms',
  AMZN: 'Amazon.com',
  TSLA: 'Tesla, Inc.',
  JPM: 'JPMorgan Chase',
  BRK_B: 'Berkshire Hathaway B',
  JNJ: 'Johnson & Johnson',
  BND: 'Vanguard Total Bond',
  VTI: 'Vanguard Total Stock',
  VOO: 'Vanguard S&P 500',
  SPY: 'SPDR S&P 500',
  QQQ: 'Invesco QQQ',
};

function resolveName(symbol: string): string {
  return TICKER_NAMES[symbol.toUpperCase()] ?? symbol;
}

