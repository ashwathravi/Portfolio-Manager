
import { db } from '@/db';
import { portfolios, holdings, transactions } from '@/db/schema';
import { StatCard } from '@/components/data-display/StatCard';
import { PortfolioCard } from '@/components/portfolios/PortfolioCard';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { AssetAllocation, DEFAULT_ALLOCATION_COLORS } from '@/components/dashboard/AssetAllocation';
import { PortfolioPerformance } from '@/components/dashboard/PortfolioPerformance';
import { Wallet, TrendingUp, DollarSign, Activity, Calendar, Plus } from 'lucide-react';
import { mockPortfolios } from '@/lib/mockData';

import { desc, eq, sql } from 'drizzle-orm';
import { Transaction } from '@/lib/mockData';

export const dynamic = 'force-dynamic'; // Ensure it doesn't cache stale data on build

export default async function Dashboard() {
  // 1. Fetch Portfolios
  // querying raw for now, or using query builder if relations work
  let allPortfolios;
  try {
    allPortfolios = await db.query.portfolios.findMany({
      with: {
        holdings: true,
        // transactions: true // If we want to verify seed transactions
      }
    });
  } catch (error) {
    console.warn('Database fetch failed, using mock data:', error instanceof Error ? error.message : String(error));
    allPortfolios = mockPortfolios;
  }

  // Fetch recent transactions
  let recentTransactions: Transaction[];
  try {
    const dbTransactions = await db.query.transactions.findMany({
      limit: 5,
      orderBy: [desc(transactions.date)],
    });

    // Map DB transactions to UI Transaction interface
    recentTransactions = dbTransactions.map(t => ({
      id: t.id,
      date: t.date.toISOString(), // Component expects string date
      type: t.type as Transaction['type'], // assuming DB has valid types
      ticker: t.ticker || undefined,
      quantity: t.quantity || undefined,
      price: t.price || undefined,
      amount: t.amount,
      notes: t.notes || undefined,
    }));
  } catch (error) {
    console.warn('Database fetch failed for transactions, using mock data:', error instanceof Error ? error.message : String(error));
    const { mockTransactions } = await import('@/lib/mockData');
    recentTransactions = mockTransactions;
  }

  // Calculate Aggregates
  let totalNetWorth = 0;
  const cashBalance = 0;
  const totalReturnDollar = 0; // This might need better tracking in DB (snapshots)

  // For MVP, we sum up current holdings value + cash
  // Note: Holdings in DB have 'marketValue' seeded from mock. In real app, we'd calculate: quantity * currentPrice

  const portfolioData = allPortfolios.map(p => {
    const holdingsValue = p.holdings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
    const pTotal = (p.cashBalance || 0) + holdingsValue;

    // We can update the 'totalValue' in the object for display, even if DB 'totalValue' is stale
    return {
      ...p,
      totalValue: pTotal,
      // We don't have 'returnDollar' in DB columns yet for Portfolios (only mocks had it)
      // We'll use 0 or calculate if we had cost basis
      returnDollar: 0,
      todayChange: 0,
      todayChangePercent: 0,
      returnPercent: 0,
    };
  });

  totalNetWorth = portfolioData.reduce((sum, p) => sum + p.totalValue, 0);

  // Mocking change data for now since we don't have historical snapshots in DB yet
  const todayChange = 1240.50;
  const todayChangePercent = totalNetWorth > 0 ? (todayChange / totalNetWorth) * 100 : 0;

  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Morning' : currentHour < 18 ? 'Afternoon' : 'Evening';
  const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // 3. Calculate Allocation Data
  const TICKER_THEMES: Record<string, string> = {
    AAPL: 'Technology',
    MSFT: 'Technology',
    NVDA: 'Technology',
    GOOGL: 'Technology',
    AMZN: 'Consumer Discretionary',
    TSLA: 'Automotive',
  };

  const allocationByAccount = portfolioData.map((p, i) => ({
    name: p.name,
    value: totalNetWorth > 0 ? (p.totalValue / totalNetWorth) * 100 : 0,
    color: DEFAULT_ALLOCATION_COLORS[i % DEFAULT_ALLOCATION_COLORS.length]
  })).filter(item => item.value > 0);

  const themeMap: Record<string, number> = {};
  allPortfolios.forEach(p => {
    p.holdings.forEach(h => {
      const theme = TICKER_THEMES[h.ticker as keyof typeof TICKER_THEMES] || 'Other';
      themeMap[theme] = (themeMap[theme] || 0) + (h.marketValue || 0);
    });
    if (p.cashBalance && p.cashBalance > 0) {
      themeMap['Cash'] = (themeMap['Cash'] || 0) + p.cashBalance;
    }
  });

  const allocationByTheme = Object.entries(themeMap).map(([name, amount], i) => ({
    name,
    value: totalNetWorth > 0 ? (amount / totalNetWorth) * 100 : 0,
    color: DEFAULT_ALLOCATION_COLORS[i % DEFAULT_ALLOCATION_COLORS.length]
  })).filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-primary/80 text-sm font-medium mb-1">
            <Calendar className="h-4 w-4" />
            <span>{currentDate}</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-black tracking-tight">Good {greeting}, Alex</h2>
          <p className="text-muted-foreground">
            Here&apos;s your portfolio overview for today.
          </p>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <button className="h-10 px-4 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm flex items-center gap-2 transition-colors shadow-lg shadow-primary/20">
            <Plus className="h-5 w-5" />
            <span>Add Asset</span>
          </button>
        </div>
      </header>

      {/* Market Status Chips */}
      <ul className="flex gap-3 overflow-x-auto pb-2" aria-label="Market Status">
        <li className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-primary/10 border border-primary/20 pl-2 pr-4">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping motion-reduce:hidden absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
          </span>
          <p className="text-primary text-xs font-bold uppercase tracking-wide">Market Open</p>
        </li>
        <li className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-card border border-border px-4">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <p className="text-muted-foreground text-xs font-medium">S&P 500 <span className="text-primary ml-1">+0.45%</span></p>
        </li>
        <li className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-lg bg-card border border-border px-4">
          <span className="text-muted-foreground text-xs font-medium">BTC <span className="text-destructive ml-1">-1.2%</span></span>
        </li>
      </ul>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <StatCard
          label="Total Net Worth"
          value={`$${totalNetWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          change={1.2}
          changeLabel="vs last month"
          trend="up"
          icon={<Wallet className="h-6 w-6" />}
        />
        <StatCard
          label="Today's P&L ($)"
          value={`+$${todayChange.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtitle="Updated 5 min ago"
          changeLabel="Good day"
          trend="up"
          change={undefined}
          icon={<DollarSign className="h-6 w-6" />}
        />
        <StatCard
          label="Today's P&L (%)"
          value={`+${todayChangePercent.toFixed(2)}%`}
          subtitle="Outperforming S&P 500 by 0.8%"
          icon={<Activity className="h-6 w-6" />}
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <PortfolioPerformance />
        <AssetAllocation
          accountData={allocationByAccount}
          themeData={allocationByTheme}
        />
      </div>

      {/* Bottom Section: Accounts & Movers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-20">
        {/* Connected Accounts */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg">Connected Accounts</h3>
            <button className="text-primary text-sm font-medium hover:underline">Manage</button>
          </div>
          <div className="flex flex-col gap-3">
            {portfolioData.map((portfolio) => (
              <PortfolioCard key={portfolio.id} portfolio={portfolio} />
            ))}
          </div>
        </div>

        {/* Top Movers activity feed */}
        <div className="flex flex-col gap-4">
          <ActivityFeed transactions={recentTransactions} />
        </div>
      </div>
    </div>
  );
}
