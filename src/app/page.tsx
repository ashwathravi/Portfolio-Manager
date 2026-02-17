'use client';

import { StatCard } from '@/components/data-display/StatCard';
import { PortfolioCard } from '@/components/portfolios/PortfolioCard';
import { PerformanceChart } from '@/components/charts/PerformanceChart';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wallet, TrendingUp, DollarSign, Activity, Calendar, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  mockPortfolios,
  mockTransactions,
  mockEquityCurve,
} from '@/lib/mockData';

export default function Dashboard() {
  const [allocationView, setAllocationView] = useState<'account' | 'theme'>('account');

  // ... (keeping existing calculation logic)

  const totalNetWorth = mockPortfolios.reduce(
    (sum, p) => sum + p.totalValue,
    0
  );
  const totalReturn = mockPortfolios.reduce(
    (sum, p) => sum + p.returnDollar,
    0
  );
  // Avoid division by zero if totalNetWorth and totalReturn are equal (initial state)
  const totalReturnPercent =
    totalNetWorth - totalReturn !== 0
      ? (totalReturn / (totalNetWorth - totalReturn)) * 100
      : 0;

  const todayChange = mockPortfolios.reduce(
    (sum, p) => sum + p.todayChange,
    0
  );
  const todayChangePercent = totalNetWorth !== 0 ? (todayChange / totalNetWorth) * 100 : 0;

  // Asset allocation data
  const allocationByAccount = [
    { name: 'Fidelity', value: 40, color: '#17cf54' },
    { name: 'Robinhood', value: 35, color: '#0bda43' },
    { name: 'Coinbase', value: 25, color: '#3c5344' },
  ];

  const allocationByTheme = [
    { name: 'Technology', value: 60, color: '#17cf54' },
    { name: 'Real Estate', value: 30, color: '#3b82f6' },
    { name: 'Energy', value: 10, color: '#f59e0b' },
  ];

  const allocationData = allocationView === 'account' ? allocationByAccount : allocationByTheme;

  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Morning' : currentHour < 18 ? 'Afternoon' : 'Evening';
  const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {/* Total Net Worth */}
        <StatCard
          label="Total Net Worth"
          value={`$${totalNetWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          change={1.2}
          changeLabel="vs last month"
          trend="up"
          icon={<Wallet className="h-6 w-6" />}
        />

        {/* Today's P&L ($) */}
        <StatCard
          label="Today's P&L ($)"
          value={`+$${todayChange.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtitle="Updated 5 min ago"
          changeLabel="Good day"
          trend="up"
          change={undefined}
          icon={<DollarSign className="h-6 w-6" />}
        />

        {/* Today's P&L (%) */}
        <StatCard
          label="Today's P&L (%)"
          value={`+${todayChangePercent.toFixed(2)}%`}
          subtitle="Outperforming S&P 500 by 0.8%"
          icon={<Activity className="h-6 w-6" />}
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Portfolio Chart */}
        <div className="lg:col-span-2 rounded-2xl bg-card border border-border p-6 flex flex-col shadow-lg">
          <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
            <div>
              <h3 className="font-bold text-lg">Portfolio Performance</h3>
              <p className="text-muted-foreground text-xs">Growth over time</p>
            </div>
            <div className="flex items-center gap-4">
              {/* Legend handled by chart component generally, but custom one here */}
            </div>
          </div>
          <div className="flex bg-accent rounded-lg p-1 border border-border self-end mb-4">
            <button className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">1D</button>
            <button className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">1W</button>
            <button className="px-3 py-1 rounded-md text-xs font-bold bg-primary/20 text-primary shadow-sm">1M</button>
            <button className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">1Y</button>
            <button className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">ALL</button>
          </div>
          <div className="flex-1 min-h-[300px]">
            <PerformanceChart data={mockEquityCurve} title="" />
          </div>
        </div>

        {/* Asset Allocation */}
        <div className="rounded-2xl bg-card border border-border p-6 flex flex-col shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg">Asset Allocation</h3>
            {/* Toggle Buttons */}
            <Tabs
              value={allocationView}
              onValueChange={(v) => setAllocationView(v as 'account' | 'theme')}
              className="w-auto"
            >
              <TabsList className="bg-accent rounded-lg p-1 border border-border h-auto">
                <TabsTrigger
                  value="account"
                  className="h-auto px-2 py-1 text-xs rounded-md hover:text-foreground data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:shadow-sm"
                >
                  Account
                </TabsTrigger>
                <TabsTrigger
                  value="theme"
                  className="h-auto px-2 py-1 text-xs rounded-md hover:text-foreground data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:shadow-sm"
                >
                  Theme
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-6">
            {/* CSS Donut Chart */}
            <div className="relative w-40 h-40 rounded-full" style={{
              background: `conic-gradient(${allocationData.map((item, idx, arr) => {
                const prevSum = arr.slice(0, idx).reduce((sum, d) => sum + d.value, 0);
                return `${item.color} ${prevSum}% ${prevSum + item.value}%`;
              }).join(', ')})`
            }}>
              <div className="absolute inset-4 bg-card rounded-full flex flex-col items-center justify-center">
                <span className="text-muted-foreground text-xs font-medium">Total</span>
                <span className="font-bold text-lg">100%</span>
              </div>
            </div>
            {/* Legend */}
            <div className="w-full flex flex-col gap-3">
              {allocationData.map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></span>
                    <span className="text-sm">{item.name}</span>
                  </div>
                  <span className="text-sm font-bold">{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
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
            {mockPortfolios.map((portfolio) => (
              <PortfolioCard key={portfolio.id} portfolio={portfolio} />
            ))}
          </div>
        </div>

        {/* Top Movers activity feed or similar */}
        <div className="flex flex-col gap-4">
          <ActivityFeed transactions={mockTransactions} />
        </div>
      </div>
    </div>
  );
}
