
import { db } from '@/db';
import { PortfolioCard, type PortfolioSummary } from '@/components/portfolios/PortfolioCard';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { AssetAllocation } from '@/components/dashboard/AssetAllocation';
import { PortfolioPerformance } from '@/components/dashboard/PortfolioPerformance';
import { TrendingUp, Calendar, Plus } from 'lucide-react';
import Link from 'next/link';
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting';
import { DashboardLiveStats, type DashboardHoldingSeed } from '@/components/dashboard/DashboardLiveStats';
import { mockTransactions } from '@/lib/mockData';
import { marketDataEngine } from '@/lib/api/market-data';
import { PageHeaderSync } from '@/components/layout/TopBar';

export const dynamic = 'force-dynamic'; // Ensure it doesn't cache stale data on build

export default async function Dashboard() {
  const allPortfolios = await db.query.portfolios.findMany({
    with: {
      holdings: true,
    }
  });

  // Fetch live quotes once server-side so the initial paint has current prices.
  // Client-side auto-refresh continues via DashboardLiveStats.
  let liveQuotes: Record<string, any> = {};
  try {
    const symbols = Array.from(new Set<string>(allPortfolios.flatMap(p => p.holdings).map((h: any) => h.symbol).filter(Boolean)));
    if (symbols.length > 0) {
      liveQuotes = await marketDataEngine.getQuotes(symbols);
    }
  } catch (e) {
    console.warn('Failed to fetch live quotes for dashboard', e);
  }

  const portfolioData: PortfolioSummary[] = allPortfolios.map(p => {
    const holdingsValue = p.holdings.reduce((sum, h) => {
      const currentPrice = liveQuotes[h.symbol]?.price ?? h.currentPrice ?? 0;
      const value = h.marketValue || (Number(h.quantity) * currentPrice);
      return sum + value;
    }, 0);
    const totalValue = (p.cashBalance || 0) + holdingsValue;
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      totalValue,
      returnDollar: 0,
      todayChange: 0,
      todayChangePercent: 0,
      returnPercent: 0,
    };
  });

  // Compute a server-side fallback for today's P&L so initial paint isn't blank
  // before the client-side refresh lands.
  let todayChange = 0;
  if (Object.keys(liveQuotes).length > 0) {
    todayChange = allPortfolios.flatMap(p => p.holdings).reduce((sum, h) => {
      const quote = liveQuotes[h.symbol];
      if (quote) {
        return sum + (quote.change * Number(h.quantity));
      }
      return sum;
    }, 0);
  } else {
    todayChange = 1240.50; // default mock
  }

  const cashTotal = allPortfolios.reduce((sum, p) => sum + (p.cashBalance || 0), 0);
  const dashboardHoldings: DashboardHoldingSeed[] = allPortfolios.flatMap((p) =>
    p.holdings
      .filter((h: any) => !!h.symbol)
      .map((h: any) => ({
        symbol: h.symbol,
        quantity: Number(h.quantity) || 0,
        currentPrice: Number(liveQuotes[h.symbol]?.price ?? h.currentPrice ?? 0),
        marketValue: Number(h.marketValue) || 0,
      })),
  );

  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Morning' : currentHour < 18 ? 'Afternoon' : 'Evening';
  const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-8 p-6">
      <PageHeaderSync
        title="Dashboard"
        subtitle={`${greeting}, ${currentDate}`}
        crumbs={["Workspace", "Dashboard"]}
      />
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-primary/80 text-sm font-medium mb-1">
            <Calendar className="h-4 w-4" />
            <span>{currentDate}</span>
          </div>
          <DashboardGreeting greeting={greeting} />
          <p className="text-muted-foreground">
            Here&apos;s your portfolio overview for today.
          </p>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/portfolios" className="h-10 px-4 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm flex items-center gap-2 transition-colors shadow-lg shadow-primary/20">
            <Plus className="h-5 w-5" />
            <span>Add Asset</span>
          </Link>
        </div>
      </header>

      {/* Market Status Chips */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        <div className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-primary/10 border border-primary/20 pl-2 pr-4">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          <p className="text-primary text-xs font-bold uppercase tracking-wide">Market Open</p>
        </div>
        <div className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-card border border-border px-4">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <p className="text-muted-foreground text-xs font-medium">S&P 500 <span className="text-primary ml-1">+0.45%</span></p>
        </div>
        <div className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-card border border-border px-4">
          <span className="text-muted-foreground text-xs font-medium">BTC <span className="text-destructive ml-1">-1.2%</span></span>
        </div>
      </div>

      {/* Stats Grid — live, auto-refreshing */}
      <DashboardLiveStats
        cashTotal={cashTotal}
        holdings={dashboardHoldings}
        fallbackTodayChange={todayChange}
      />

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <PortfolioPerformance />
        <AssetAllocation />
      </div>

      {/* Bottom Section: Accounts & Movers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-20">
        {/* Connected Accounts */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">Connected Accounts</h3>
            <Link href="/portfolios" className="text-primary text-sm font-medium hover:underline">Manage</Link>
          </div>
          <div className="flex flex-col gap-3">
            {portfolioData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No portfolios found. Add one to get started.</p>
            ) : (
              portfolioData.map((portfolio) => (
                <PortfolioCard key={portfolio.id} portfolio={portfolio} />
              ))
            )}
          </div>
        </div>

        {/* Top Movers activity feed */}
        <div className="flex flex-col gap-4">
          <ActivityFeed transactions={mockTransactions} />
        </div>
      </div>
    </div>
  );
}
