'use client';

import { memo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface PerformanceChartProps {
    data: Array<{
        date: string;
        portfolio: number;
        benchmark: number;
    }>;
    title?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Optimized: Manual date parsing avoids `new Date()` allocation and timezone issues.
// significantly faster than creating Date objects inside render loops.
// Format: "YYYY-MM-DD" -> "M/D" (e.g., "2024-02-05" -> "2/5")
const formatDateTick = (value: string) => {
    // "YYYY-MM-DD" is 10 chars
    //  0123456789
    // month is at 5,7. day is at 8,10.
    if (typeof value === 'string' && value.length >= 10) {
        const m = parseInt(value.substring(5, 7), 10);
        const d = parseInt(value.substring(8, 10), 10);
        return `${m}/${d}`;
    }
    return value;
};

// Optimized: Manual date parsing avoids `new Date()` allocation.
// Format: "YYYY-MM-DD" -> "MMM D, YYYY" (e.g., "Feb 5, 2024")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatDateLabel = (value: any) => {
    if (typeof value === 'string' && value.length >= 10) {
        const y = parseInt(value.substring(0, 4), 10);
        const m = parseInt(value.substring(5, 7), 10);
        const d = parseInt(value.substring(8, 10), 10);
        return `${MONTHS[m - 1]} ${d}, ${y}`;
    }
    return value;
};

// Optimized: Cached Intl.NumberFormat instance avoids re-creation on every render/tooltip.
const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const formatTooltipValue = (value: number | undefined) => {
    if (value === undefined) return '';
    return currencyFormatter.format(value);
};

// Optimized: Stable function reference.
const formatYAxisTick = (value: number) => `$${(value / 1000).toFixed(0)}k`;

// Optimized: Wrapped in React.memo to prevent unnecessary re-renders when parent state updates
export const PerformanceChart = memo(function PerformanceChart({ data, title = 'Performance' }: PerformanceChartProps) {
    return (
        <>
            {title && (
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h3 className="text-lg font-bold">{title}</h3>
                        <p className="text-sm text-muted-foreground mt-1">Comparative growth over selected period</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full bg-primary"></span>
                            <span className="text-sm font-medium">Portfolio</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full bg-muted-foreground"></span>
                            <span className="text-sm font-medium text-muted-foreground">S&P 500</span>
                        </div>
                    </div>
                </div>
            )}
            <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data}>
                    <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis
                        dataKey="date"
                        tickFormatter={formatDateTick}
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                    />
                    <YAxis
                        tickFormatter={formatYAxisTick}
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                    />
                    <Tooltip
                        formatter={formatTooltipValue}
                        labelFormatter={formatDateLabel}
                        contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '0.75rem',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                        }}
                        labelStyle={{
                            color: 'hsl(var(--muted-foreground))',
                            fontSize: '12px',
                            fontWeight: 600,
                        }}
                    />
                    <Line
                        type="monotone"
                        dataKey="portfolio"
                        stroke="hsl(var(--primary))"
                        strokeWidth={3}
                        dot={false}
                        name="Portfolio"
                        strokeLinecap="round"
                    />
                    <Line
                        type="monotone"
                        dataKey="benchmark"
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={2}
                        strokeDasharray="6 6"
                        dot={false}
                        name="S&P 500"
                        strokeLinecap="round"
                    />
                </LineChart>
            </ResponsiveContainer>
        </>
    );
});
