'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useState, useMemo, memo } from 'react';

// Asset allocation data moved outside to prevent recreation on every render
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

// Types for props (can be refined based on DB types later)
interface AssetAllocationProps {
    // If data is passed from parent, use it. Otherwise retain internal logic for now or update later.
}

// Optimized: Wrapped in React.memo to prevent unnecessary re-renders when parent state updates.
export const AssetAllocation = memo(function AssetAllocation() {
    const [allocationView, setAllocationView] = useState<'account' | 'theme'>('account');

    const allocationData = allocationView === 'account' ? allocationByAccount : allocationByTheme;

    // Optimized: Memoize gradient string to avoid O(N) string construction on every render.
    // Also optimized loop from O(N^2) (nested reduce) to O(N) (single pass).
    const gradientBackground = useMemo(() => {
        let currentSum = 0;
        const stops = allocationData.map((item) => {
            const start = currentSum;
            currentSum += item.value;
            return `${item.color} ${start}% ${currentSum}%`;
        });
        return `conic-gradient(${stops.join(', ')})`;
    }, [allocationData]);

    return (
        <div className="rounded-2xl bg-card border border-border p-6 flex flex-col shadow-lg h-full">
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
                    background: gradientBackground
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
    );
});
