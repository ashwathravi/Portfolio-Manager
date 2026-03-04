"use client"

import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import Link from "next/link";
import { BacktestResult } from "@/types/strategy";
import { exportToCsv } from '@/lib/exportCsv';
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area, TooltipProps } from 'recharts';

// Mock Data
const mockBacktest: BacktestResult = {
    id: "bt_1",
    strategyId: "st_1",
    status: "completed",
    startDate: new Date("2023-01-01"),
    endDate: new Date("2023-12-31"),
    initialCapital: 100000,
    finalCapital: 142500,
    totalReturn: 42500,
    totalReturnPercent: 42.5,
    cagr: 42.5,
    metrics: {
        sharpeRatio: 1.85,
        sortinoRatio: 2.10,
        maxDrawdown: -14.2,
        maxDrawdownDuration: 45,
        winRate: 58,
        profitFactor: 1.6,
        beta: 0.85,
        alpha: 12.4,
        volatility: 18.5
    },
    trades: [], // Populated in a real app
    equityCurve: Array.from({ length: 12 }, (_, i) => ({
        date: new Date(2023, i, 1),
        equity: 100000 * (1 + (i * 0.03 + (Math.sin(i) * 0.025 + 0.025))),
        drawdown: (Math.cos(i) * 5 - 5)
    })),
    robustness: {
        monteCarloProbDrawdown: 95,
        regimeAnalysis: {
            bullMarketReturn: 45,
            bearMarketReturn: -5,
            highVolReturn: 12
        }
    },
    runDate: new Date()
};

const CustomTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (active && payload && payload.length) {
        const date = label ? new Date(label) : null;
        return (
            <div className="bg-background border rounded p-2 shadow-md">
                <p className="label text-sm font-medium">
                    {date && !isNaN(date.getTime()) ? date.toLocaleDateString() : 'Invalid Date'}
                </p>
                <p className="text-sm text-primary">Equity: ${payload[0].value?.toFixed(2)}</p>
            </div>
        );
    }
    return null;
};

export default function BacktestPage() {
    ;
    // id would be used to fetch
    const results = mockBacktest;

    return (
        <AppShell>
            <div className="flex items-center justify-between space-y-2 mb-8">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" asChild aria-label="Back to Strategies">
                        <Link href="/strategies"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
                    </Button>
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">Backtest Results</h2>
                        <div className="flex items-center gap-2 text-muted-foreground mt-1">
                            <span>S&P 500 Momentum</span>
                            <Badge variant="success">Completed</Badge>
                        </div>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <Button variant="outline">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Re-run
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() =>
                            exportToCsv('backtest-report.csv', [
                                {
                                    'Start Date': results.startDate.toLocaleDateString(),
                                    'End Date': results.endDate.toLocaleDateString(),
                                    'Initial Capital': results.initialCapital,
                                    'Final Capital': results.finalCapital,
                                    'Total Return': results.totalReturn,
                                    'Total Return %': results.totalReturnPercent,
                                    'CAGR %': results.cagr,
                                    'Sharpe Ratio': results.metrics.sharpeRatio,
                                    'Sortino Ratio': results.metrics.sortinoRatio,
                                    'Max Drawdown %': results.metrics.maxDrawdown,
                                    'Win Rate %': results.metrics.winRate,
                                    'Profit Factor': results.metrics.profitFactor,
                                    'Beta': results.metrics.beta,
                                    'Alpha %': results.metrics.alpha,
                                    'Volatility %': results.metrics.volatility,
                                },
                                ...results.equityCurve.map((p) => ({
                                    'Date': p.date.toLocaleDateString(),
                                    'Equity': p.equity.toFixed(2),
                                    'Drawdown %': p.drawdown.toFixed(2),
                                })),
                            ])
                        }
                    >
                        <Download className="mr-2 h-4 w-4" />
                        Export Report
                    </Button>
                </div>
            </div>

            {/* Metrics Header */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Net Profit</div>
                        <div className="text-2xl font-bold text-success-600">
                            +{results.totalReturnPercent}%
                        </div>
                        <div className="text-xs text-muted-foreground">${results.totalReturn.toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Sharpe Ratio</div>
                        <div className="text-2xl font-bold">{results.metrics.sharpeRatio}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Max Drawdown</div>
                        <div className="text-2xl font-bold text-danger-600">{results.metrics.maxDrawdown}%</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Win Rate</div>
                        <div className="text-2xl font-bold">{results.metrics.winRate}%</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Alpha</div>
                        <div className="text-2xl font-bold">+{results.metrics.alpha}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-xs font-semibold text-muted-foreground uppercase">Sortino</div>
                        <div className="text-2xl font-bold">{results.metrics.sortinoRatio}</div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                {/* Equity Curve */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Equity Curve</CardTitle>
                        <CardDescription>Portfolio value over time vs Benchmark</CardDescription>
                    </CardHeader>
                    <CardContent className="h-[350px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={results.equityCurve}>
                                <defs>
                                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(date) => new Date(date).toLocaleDateString(undefined, { month: 'short' })}
                                />
                                <YAxis />
                                <Tooltip content={<CustomTooltip />} />
                                <Area type="monotone" dataKey="equity" stroke="#8884d8" fillOpacity={1} fill="url(#colorEquity)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Robustness */}
                <Card>
                    <CardHeader>
                        <CardTitle>Robustness Analysis</CardTitle>
                        <CardDescription>Stress testing results</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div>
                            <h4 className="font-semibold text-sm mb-2">Monte Carlo Simulation</h4>
                            <p className="text-sm text-muted-foreground">
                                {results.robustness?.monteCarloProbDrawdown}% Probability that Max Drawdown will NOT exceed 18% in the next 12 months.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-semibold text-sm">Regime Analysis</h4>
                            <div className="flex justify-between text-sm border-b pb-1">
                                <span>Bull Market</span>
                                <span className="text-success-600">+{results.robustness?.regimeAnalysis.bullMarketReturn}%</span>
                            </div>
                            <div className="flex justify-between text-sm border-b pb-1">
                                <span>Bear Market</span>
                                <span className="text-danger-600">{results.robustness?.regimeAnalysis.bearMarketReturn}%</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>High Volatility</span>
                                <span>+{results.robustness?.regimeAnalysis.highVolReturn}%</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </AppShell>
    );
}
