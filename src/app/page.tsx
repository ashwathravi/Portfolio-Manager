import { db } from '@/db';
import { marketDataEngine } from '@/lib/api/market-data';
import { PageHeaderSync } from '@/components/layout/TopBar';
import { DashboardTopbar } from '@/components/dashboard/DashboardTopbar';
import { DashboardStatRow, type DashboardStatRowHolding } from '@/components/dashboard/DashboardStatRow';
import { EquityChartCard } from '@/components/dashboard/EquityChartCard';
import { AllocationCard, type AllocationHolding } from '@/components/dashboard/AllocationCard';
import { TopHoldingsCard, type TopHoldingsRow } from '@/components/dashboard/TopHoldingsCard';
import { RecentActivityCard, type ActivityRow } from '@/components/dashboard/RecentActivityCard';
import { WatchlistCard } from '@/components/dashboard/WatchlistCard';
import { ActiveThesesCard } from '@/components/dashboard/ActiveThesesCard';
import { DailyBriefCard } from '@/components/dashboard/DailyBriefCard';
import { mockTransactions } from '@/lib/mockData';

/**
 * Phase 3 Dashboard (AR-70/71/72/73).
 *
 * This is a server component by design — it does the live-quotes fetch for
 * the initial paint, builds the derived dashboard data, and hands each
 * section off to a client component. All live-polling + interactivity is
 * contained in the client children.
 */

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const allPortfolios = await db.query.portfolios.findMany({
    with: { holdings: true },
  });

  // ---- Initial server-side quote fetch (warms the TanStack Query cache) ----
  let liveQuotes: Record<string, {
    price: number;
    change?: number;
    changePercent?: number;
  }> = {};
  try {
    const symbols = Array.from(
      new Set<string>(
        allPortfolios
          .flatMap((p) => p.holdings)
          .map((h: { symbol: string }) => h.symbol)
          .filter(Boolean),
      ),
    );
    if (symbols.length > 0) {
      liveQuotes = await marketDataEngine.getQuotes(symbols);
    }
  } catch (e) {
    console.warn('Failed to fetch live quotes for dashboard', e);
  }

  // ---- Derive once, pass everywhere ----
  const cashTotal = allPortfolios.reduce((s, p) => s + (p.cashBalance || 0), 0);

  // Drizzle returns numeric columns as strings, so we coerce inside the map
  // (don't annotate h — the schema type is what matters).
  const allHoldings = allPortfolios.flatMap((p) =>
    p.holdings.map((h) => ({
      id: h.id,
      portfolio: p.name,
      symbol: h.symbol,
      quantity: Number(h.quantity) || 0,
      avgCost: Number(h.avgCost) || 0,
      currentPrice: Number(liveQuotes[h.symbol]?.price ?? h.currentPrice ?? 0),
      marketValue: Number(h.marketValue) || 0,
    })),
  );

  // Today's P&L fallback for before the client poll lands.
  let todayChange = 0;
  if (Object.keys(liveQuotes).length > 0) {
    todayChange = allHoldings.reduce((sum, h) => {
      const q = liveQuotes[h.symbol];
      if (q?.change != null) return sum + q.change * h.quantity;
      return sum;
    }, 0);
  }

  const netWorthSeed = cashTotal + allHoldings.reduce(
    (sum, h) => sum + (h.marketValue || h.quantity * h.currentPrice),
    0,
  );

  const statRowHoldings: DashboardStatRowHolding[] = allHoldings
    .filter((h) => h.symbol)
    .map((h) => ({
      symbol: h.symbol,
      quantity: h.quantity,
      currentPrice: h.currentPrice,
      marketValue: h.marketValue,
    }));

  const allocationHoldings: AllocationHolding[] = allHoldings.map((h) => ({
    symbol: h.symbol,
    portfolio: h.portfolio,
    marketValue: h.marketValue || h.quantity * h.currentPrice,
  }));
  const cashByPortfolio = Object.fromEntries(
    allPortfolios.map((p) => [p.name, p.cashBalance || 0]),
  );

  const topHoldingsRows: TopHoldingsRow[] = allHoldings.map((h) => ({
    id: h.id,
    symbol: h.symbol,
    name: resolveName(h.symbol),
    quantity: h.quantity,
    avgCost: h.avgCost,
    currentPrice: h.currentPrice,
    marketValue: h.marketValue || h.quantity * h.currentPrice,
  }));

  // ---- Recent activity: last 30 days from mock until we wire live txns ----
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const activities: ActivityRow[] = mockTransactions
    .filter((t) => new Date(t.date) >= thirtyDaysAgo)
    .map((t) => ({
      id: t.id,
      type: t.type,
      date: new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      ticker: t.ticker,
      quantity: t.quantity,
      amount: t.amount,
      notes: t.notes,
    }));

  const greetingSubtitle = `${new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  return (
    <div className="pm-dashboard-stack p-6">
      <PageHeaderSync
        title="Dashboard"
        subtitle={greetingSubtitle}
        crumbs={['Home', 'Dashboard']}
      />

      {/* ---- AR-71: topbar + stat row + chart/allocation split ---- */}
      <DashboardTopbar />

      <DashboardStatRow
        cashTotal={cashTotal}
        holdings={statRowHoldings}
        fallbackTodayChange={todayChange}
        alphaVsSp={1.8}
      />

      <div className="pm-grid-2">
        <EquityChartCard netWorth={netWorthSeed} seed={allHoldings.length} />
        <AllocationCard
          holdings={allocationHoldings}
          cashByPortfolio={cashByPortfolio}
        />
      </div>

      {/* ---- AR-72: 63/37 holdings + activity split ---- */}
      <div className="pm-grid-2-63">
        <TopHoldingsCard rows={topHoldingsRows} limit={6} />
        <RecentActivityCard activities={activities} limit={8} />
      </div>

      {/* ---- AR-73: bottom 3-col strip ---- */}
      <div className="pm-grid-3">
        <WatchlistCard
          rows={DEFAULT_WATCHLIST}
          limit={5}
        />
        <ActiveThesesCard rows={DEFAULT_THESES} limit={3} />
        <DailyBriefCard items={DEFAULT_BRIEF_ITEMS} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seed data (replace with live sources as those features come online)
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

const DEFAULT_WATCHLIST = [
  { symbol: 'SPY', name: 'SPDR S&P 500', fallbackPrice: 547.20, fallbackChangePct: 0.45 },
  { symbol: 'QQQ', name: 'Invesco QQQ', fallbackPrice: 478.60, fallbackChangePct: 0.88 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', fallbackPrice: 932.10, fallbackChangePct: 2.14 },
  { symbol: 'META', name: 'Meta Platforms', fallbackPrice: 512.45, fallbackChangePct: -0.72 },
  { symbol: 'COIN', name: 'Coinbase Global', fallbackPrice: 214.30, fallbackChangePct: 3.55 },
];

const DEFAULT_THESES = [
  {
    id: 'th-1',
    tag: 'SEMI',
    name: 'AI capex cycle extends into 2026',
    state: 'Watching',
    conviction: 'High' as const,
    spark: [100, 102, 101, 104, 108, 106, 110, 114, 117, 120],
    href: '/research',
  },
  {
    id: 'th-2',
    tag: 'CONSUMER',
    name: 'Apple margin compression risk',
    state: 'Active',
    conviction: 'Med' as const,
    spark: [100, 99, 101, 98, 97, 95, 96, 93, 94, 92],
    href: '/research',
  },
  {
    id: 'th-3',
    tag: 'MACRO',
    name: 'Fed pivot: rate cuts Q3',
    state: 'Fading',
    conviction: 'Low' as const,
    spark: [100, 101, 100, 101, 102, 101, 100, 99, 100, 99],
    href: '/research',
  },
];

const DEFAULT_BRIEF_ITEMS = [
  {
    title: 'Rebalance tech exposure',
    description:
      'AAPL + NVDA now 34% of portfolio. Consider trimming 5–8% back toward target.',
  },
  {
    title: 'Review cash runway',
    description:
      'Cash balance covers 8.4 months of burn. Redeploy or reallocate per IPS.',
  },
  {
    title: 'Close dormant thesis',
    description:
      'Macro "Fed pivot" thesis has been Fading for 14 days — archive or act.',
  },
];
