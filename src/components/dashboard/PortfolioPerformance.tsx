'use client';

import { useEffect, useState } from 'react';
import { PerformanceChart } from '@/components/charts/PerformanceChart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Import mock data locally if needed, but preferably accept as props
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

export function PortfolioPerformance({ data }: { data?: PerformanceData[] }) {
    const [chartData, setChartData] = useState<PerformanceData[]>(data || mockEquityCurve);
    const [period, setPeriod] = useState<string>('1M');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (data) {
            setChartData(data);
            return;
        }

        async function fetchMarketData() {
            setIsLoading(true);
            try {
                // Map UI period to API timeframe
                let timeframe = '1D';
                if (period === '1D') timeframe = '1M'; // intra-day
                if (period === '1W') timeframe = '1H'; // hourly

                // Fetch SPY to simulate a benchmark curve and maybe another for portfolio
                const res = await fetch(`/api/market-data/historical?symbol=SPY&timeframe=${timeframe}`);
                if (!res.ok) throw new Error('API fetching error');

                const json = await res.json();

                if (Array.isArray(json) && json.length > 0) {
                    const formatted: PerformanceData[] = json.map((bar: any) => ({
                        date: new Date(bar.time).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: timeframe !== '1D' ? 'numeric' : undefined
                        }),
                        portfolio: bar.close * 125, // Mock scaling to look like a portfolio value
                        benchmark: bar.close * 100
                    }));
                    setChartData(formatted);
                } else if (!json.error) {
                    setChartData(mockEquityCurve);
                }
            } catch (err) {
                console.warn('Failed to fetch historical data, falling back to mock: ', err);
                setChartData(mockEquityCurve);
            } finally {
                setIsLoading(false);
            }
        }

        fetchMarketData();
    }, [period, data]);

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
                    {isLoading && (
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
