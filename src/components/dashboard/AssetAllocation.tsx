'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useState, useMemo, memo } from 'react';

export interface AllocationItem {
    name: string;
    value: number;
    color: string;
}

export const DEFAULT_ALLOCATION_COLORS = [
    '#17cf54', // Primary/Emerald
    '#3b82f6', // Blue
    '#f59e0b', // Amber
    '#ef4444', // Red
    '#8b5cf6', // Violet
    '#06b6d4', // Cyan
    '#ec4899', // Pink
];

// Optimized: Moved static data outside component to prevent recreation on every render
const DEFAULT_ACCOUNT_DATA = [
    { name: 'Fidelity', value: 40, color: DEFAULT_ALLOCATION_COLORS[0] },
    { name: 'Robinhood', value: 35, color: DEFAULT_ALLOCATION_COLORS[1] },
    { name: 'Coinbase', value: 25, color: DEFAULT_ALLOCATION_COLORS[2] },
];

const DEFAULT_THEME_DATA = [
    { name: 'Technology', value: 60, color: DEFAULT_ALLOCATION_COLORS[0] },
    { name: 'Real Estate', value: 30, color: DEFAULT_ALLOCATION_COLORS[1] },
    { name: 'Energy', value: 10, color: DEFAULT_ALLOCATION_COLORS[2] },
];

// Optimized: Pure function outside component to avoid recreation
// Ensures every item has a color (server may not pass colors from 'use client' exports)
const ensureColors = (items: AllocationItem[]) =>
    items.map((item, i) => item.color ? item : { ...item, color: DEFAULT_ALLOCATION_COLORS[i % DEFAULT_ALLOCATION_COLORS.length] });

// Optimized: Helper function for gradient calculation
const computeGradient = (data: AllocationItem[]) => {
    let currentSum = 0;
    const stops: string[] = [];
    for (const item of data) {
        const start = currentSum;
        currentSum += item.value;
        stops.push(`${item.color} ${start}% ${currentSum}%`);
    }
    return `conic-gradient(${stops.join(', ')})`;
};

interface AssetAllocationProps {
    accountData?: AllocationItem[];
    themeData?: AllocationItem[];
}

// Optimized: Wrapped in React.memo to prevent unnecessary re-renders when parent state updates.
export const AssetAllocation = memo(function AssetAllocation({ accountData, themeData }: AssetAllocationProps) {
    const [allocationView, setAllocationView] = useState<'account' | 'theme'>('account');

    // Optimized: Use useMemo to prevent recalculation and new array references when switching tabs (local state change).
    // This ensures that 'ensureColors' logic (O(N) iteration) is skipped when just toggling views.
    const currentAccountData = useMemo(() => ensureColors(accountData || DEFAULT_ACCOUNT_DATA), [accountData]);
    const currentThemeData = useMemo(() => ensureColors(themeData || DEFAULT_THEME_DATA), [themeData]);

    const allocationData = allocationView === 'account' ? currentAccountData : currentThemeData;

    // Optimized: Memoize gradient strings separately so switching tabs is O(1) string selection
    // rather than O(N) string construction.
    const accountGradient = useMemo(() => computeGradient(currentAccountData), [currentAccountData]);
    const themeGradient = useMemo(() => computeGradient(currentThemeData), [currentThemeData]);

    const gradientBackground = allocationView === 'account' ? accountGradient : themeGradient;

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
                            aria-label="View allocation by account"
                            className="h-auto px-2 py-1 text-xs rounded-md hover:text-foreground data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:shadow-sm"
                        >
                            Account
                        </TabsTrigger>
                        <TabsTrigger
                            value="theme"
                            aria-label="View allocation by theme"
                            className="h-auto px-2 py-1 text-xs rounded-md hover:text-foreground data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:font-bold data-[state=active]:shadow-sm"
                        >
                            Theme
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
                {/* CSS Donut Chart */}
                {allocationData.length > 0 ? (
                    <div
                        className="relative w-40 h-40 rounded-full"
                        style={{ background: gradientBackground }}
                        role="img"
                        aria-label={`Asset allocation chart showing distribution by ${allocationView}`}
                    >
                        <div className="absolute inset-4 bg-card rounded-full flex flex-col items-center justify-center">
                            <span className="text-muted-foreground text-xs font-medium">Total</span>
                            <span className="font-bold text-lg">100%</span>
                        </div>
                    </div>
                ) : (
                    <div className="w-40 h-40 rounded-full bg-accent flex items-center justify-center">
                        <span className="text-muted-foreground text-xs">No data</span>
                    </div>
                )}
                {/* Legend */}
                <ul className="w-full flex flex-col gap-3" aria-label="Legend">
                    {allocationData.map((item) => (
                        <li key={`${item.name}-${item.color}`} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: item.color }}
                                    aria-hidden="true"
                                ></span>
                                <span className="text-sm">{item.name}</span>
                            </div>
                            <span className="text-sm font-bold">
                                {Number.isInteger(item.value) ? item.value : item.value.toFixed(1)}%
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
});
