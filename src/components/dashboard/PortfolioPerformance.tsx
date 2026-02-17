
'use client';

import { PerformanceChart } from '@/components/charts/PerformanceChart';

// Import mock data locally if needed, but preferably accept as props
import { mockEquityCurve } from '@/lib/mockData';

export function PortfolioPerformance({ data = mockEquityCurve }: { data?: any[] }) {
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
            <div className="flex bg-accent rounded-lg p-1 border border-border self-end mb-4">
                <button className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">1D</button>
                <button className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">1W</button>
                <button className="px-3 py-1 rounded-md text-xs font-bold bg-primary/20 text-primary shadow-sm">1M</button>
                <button className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">1Y</button>
                <button className="px-3 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">ALL</button>
            </div>
            <div className="flex-1 min-h-[300px]">
                <PerformanceChart data={data} title="" />
            </div>
        </div>
    );
}
