'use client';

import { useMemo, useState } from 'react';
import { PerformanceChart } from '@/components/charts/PerformanceChart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHistoricalQuery, type Timeframe } from '@/lib/api/market-data/queries';
import { mockEquityCurve } from '@/lib/mockData';

interface PerformanceData {
    date: string;
    portfolio: number;
    benchmark: number;
}

const rangeLabels: Record<string, string> = {
    '1D': '1 Day',
    '1W': '1 Week',
    '1M': '1 Month',
    '1Y': '1 Year',
    'ALL': 'All Time',
};

function periodToTimeframe(period: string): Timeframe {
    if (period === '1D') return '1M';
    if (period === '1W') return '1H';
    return '1D';
}

export function PortfolioPerformance({ data }: { data?: PerformanceData[] }) {
    const [period, setPeriod] = useState<string>('1M');
    const timeframe = periodToTimeframe(period);

    const { data: bars, isFetching, isError } = useHistoricalQuery('SPY', timeframe, {
        enabled: !data,
    });

    const chartData = useMemo<PerformanceData[]>(() => {
        if (data) return data;
        if (isError || !bars || bars.length === 0) return mockEquityCurve;
        return bars.map((bar) => ({
            date: new Date(bar.time).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: timeframe !== '1D' ? 'numeric' : undefined,
            }),
            portfolio: bar.close * 125,
            benchmark: bar.close * 100,
        }));
    }, [data, bars, isError, timeframe]);

    return (
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

            <Tabs defaultValue="1M" value={period} onValueChange={setPeriod} className="flex flex-col w-full h-full flex-1">
                <TabsList className="bg-accent rounded-lg p-1 border border-border self-end mb-4 w-auto h-auto inline-flex items-center justify-center">
                    {['1D', '1W', '1M', '1Y', 'ALL'].map((p) => (
                        <TabsTrigger
                            key={p}
                            value={p}
                            aria-label={rangeLabels[p]}
                            className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:shadow-sm h-auto"
                        >
                            {p}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <div className="flex-1 min-h-[300px] relative">
                    {isFetching && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 rounded-lg backdrop-blur-sm">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        </div>
                    )}
                    <PerformanceChart data={chartData} title="" />
                </div>
            </Tabs>
        </div>
    );
}
