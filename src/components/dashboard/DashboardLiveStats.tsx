'use client';

import { useMemo } from 'react';
import { StatCard } from '@/components/data-display/StatCard';
import { LiveDataIndicator } from '@/components/data-display/LiveDataIndicator';
import { useAutoRefreshQuotes } from '@/lib/hooks/useAutoRefreshQuotes';
import { Wallet, DollarSign, Activity } from 'lucide-react';

export interface DashboardHoldingSeed {
    symbol: string;
    quantity: number;
    currentPrice: number;
    marketValue: number;
}

interface DashboardLiveStatsProps {
    cashTotal: number;
    holdings: DashboardHoldingSeed[];
    fallbackTodayChange: number;
}

export function DashboardLiveStats({
    cashTotal,
    holdings,
    fallbackTodayChange,
}: DashboardLiveStatsProps) {
    const symbols = useMemo(
        () => holdings.map((h) => h.symbol).filter(Boolean),
        [holdings],
    );

    const { quotes, isFetching, isError, refreshMs, refetch, lastUpdatedAt } =
        useAutoRefreshQuotes(symbols);

    const { totalNetWorth, todayChange, hasLiveData } = useMemo(() => {
        let netHoldings = 0;
        let change = 0;
        let live = false;

        for (const h of holdings) {
            const quote = quotes[h.symbol.toUpperCase()];
            if (quote && Number.isFinite(quote.price)) {
                netHoldings += h.quantity * quote.price;
                change += (quote.change ?? 0) * h.quantity;
                live = true;
            } else {
                netHoldings += h.marketValue || h.quantity * h.currentPrice;
            }
        }

        return {
            totalNetWorth: cashTotal + netHoldings,
            todayChange: live ? change : fallbackTodayChange,
            hasLiveData: live,
        };
    }, [holdings, quotes, cashTotal, fallbackTodayChange]);

    const todayChangePercent =
        totalNetWorth > 0 ? (todayChange / Math.max(totalNetWorth - todayChange, 1)) * 100 : 0;

    const todayIsPositive = todayChange >= 0;
    const changeSign = todayIsPositive ? '+' : '';

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-end">
                <LiveDataIndicator
                    isFetching={isFetching}
                    isError={isError && !hasLiveData}
                    refreshMs={refreshMs}
                    lastUpdatedAt={lastUpdatedAt}
                    onRefresh={() => refetch()}
                />
            </div>
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
                    value={`${changeSign}$${Math.abs(todayChange).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    subtitle={hasLiveData ? 'Live from market data' : 'Awaiting live quotes'}
                    trend={todayIsPositive ? 'up' : 'down'}
                    icon={<DollarSign className="h-6 w-6" />}
                />
                <StatCard
                    label="Today's P&L (%)"
                    value={`${changeSign}${todayChangePercent.toFixed(2)}%`}
                    subtitle={hasLiveData ? 'Computed from live quotes' : 'Awaiting live quotes'}
                    trend={todayIsPositive ? 'up' : 'down'}
                    icon={<Activity className="h-6 w-6" />}
                />
            </div>
        </div>
    );
}
