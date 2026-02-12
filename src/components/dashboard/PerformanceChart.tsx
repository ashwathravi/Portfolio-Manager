'use client';

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

interface PerformanceChartProps {
    data: Array<{
        date: string;
        portfolio: number;
        benchmark: number;
    }>;
    title?: string;
}

export function PerformanceChart({ data, title = 'Performance' }: PerformanceChartProps) {
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
                        tickFormatter={(value) => {
                            const date = new Date(value);
                            return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                    />
                    <YAxis
                        tickFormatter={(value) =>
                            `$${(value / 1000).toFixed(0)}k`
                        }
                        stroke="hsl(var(--muted-foreground))"
                        style={{ fontSize: '12px', fontWeight: 500 }}
                        tickLine={false}
                    />
                    <Tooltip
                        formatter={(value: number | undefined) =>
                            value !== undefined ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
                        }
                        labelFormatter={(label) => {
                            const date = new Date(label);
                            return date.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                            });
                        }}
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
}
