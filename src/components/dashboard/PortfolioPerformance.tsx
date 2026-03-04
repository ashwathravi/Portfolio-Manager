'use client';

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

export function PortfolioPerformance({ data = mockEquityCurve }: { data?: PerformanceData[] }) {
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

            <Tabs defaultValue="1M" className="flex flex-col w-full h-full flex-1">
                <TabsList className="bg-accent rounded-lg p-1 border border-border self-end mb-4 w-auto h-auto inline-flex items-center justify-center">
                    {['1D', '1W', '1M', '1Y', 'ALL'].map((period) => (
                        <TabsTrigger
                            key={period}
                            value={period}
                            aria-label={rangeLabels[period]}
                            className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:shadow-sm h-auto"
                        >
                            {period}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <div className="flex-1 min-h-[300px]">
                    <PerformanceChart data={data} title="" />
                </div>
            </Tabs>
        </div>
    );
}
