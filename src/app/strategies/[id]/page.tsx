'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    ChevronRight,
    Download,
    Play,
    TrendingUp,
    TrendingDown,
    Activity,
    Target,
    Award,
} from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { exportToCsv } from '@/lib/exportCsv';
import {
    AreaChart,
    Area,
    Line,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { mockStrategyData } from '@/lib/mockData';

export default function StrategyDetailPage() {
    const router = useRouter();
    const params = useParams();

    // Extract strategy ID from URL parameters
    const strategyId = params.id as string || '';
    const strategy = mockStrategyData[strategyId];

    if (!strategy) {
        return (
            <div className="flex h-full items-center justify-center p-12">
                <p className="text-muted-foreground">Strategy not found</p>
            </div>
        );
    }

    const cagr = (((strategy.finalValue / strategy.initialCapital) ** (1 / 4) - 1) * 100).toFixed(2);

    return (
        <div className="space-y-6 p-6">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm">
                <button
                    onClick={() => router.push('/strategies')}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                >
                    Strategies
                </button>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <span className="text-foreground font-medium">{strategy.name}</span>
            </div>

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-3xl font-bold tracking-tight">{strategy.name}</h1>
                        <Badge
                            variant={
                                strategy.status === 'active'
                                    ? 'default'
                                    : strategy.status === 'paused'
                                        ? 'secondary'
                                        : 'outline'
                            }
                        >
                            {strategy.status}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground mb-1">{strategy.description}</p>
                    <p className="text-sm text-muted-foreground">
                        Backtest Period: {strategy.backtestPeriod}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                        <Play className="h-4 w-4 mr-2" />
                        Re-run Backtest
                    </Button>
                    <Button
                        size="sm"
                        onClick={() =>
                            exportToCsv(`strategy-${strategy.name.replace(/\s+/g, '-').toLowerCase()}.csv`, [{
                                Name: strategy.name,
                                Status: strategy.status,
                                Description: strategy.description,
                                'Backtest Period': strategy.backtestPeriod,
                                'Initial Capital': strategy.initialCapital,
                                'Final Value': strategy.finalValue,
                                'Total Return %': ((strategy.finalValue / strategy.initialCapital - 1) * 100).toFixed(2),
                                'CAGR %': cagr,
                                'Sharpe Ratio': strategy.sharpeRatio,
                                'Max Drawdown %': strategy.maxDrawdown,
                                'Win Rate %': strategy.winRate,
                                'Total Trades': strategy.totalTrades,
                            }])
                        }
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Export Report
                    </Button>
                </div>
            </div>

            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        <p className="text-xs text-muted-foreground">Net Profit</p>
                    </div>
                    <p className="text-2xl font-bold text-primary">
                        ${(strategy.netProfit / 1000).toFixed(1)}K
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                        +{strategy.netProfitPercent.toFixed(1)}%
                    </p>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Activity className="h-4 w-4 text-primary" />
                        <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
                    </div>
                    <p className="text-2xl font-bold">{strategy.sharpeRatio.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Risk-adjusted</p>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <TrendingDown className="h-4 w-4 text-destructive" />
                        <p className="text-xs text-muted-foreground">Max Drawdown</p>
                    </div>
                    <p className="text-2xl font-bold text-destructive">
                        {strategy.maxDrawdown.toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Peak to trough</p>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Target className="h-4 w-4 text-primary" />
                        <p className="text-xs text-muted-foreground">Win Rate</p>
                    </div>
                    <p className="text-2xl font-bold">{strategy.winRate.toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        {strategy.totalTrades} trades
                    </p>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Award className="h-4 w-4 text-primary" />
                        <p className="text-xs text-muted-foreground">Alpha</p>
                    </div>
                    <p className="text-2xl font-bold">{strategy.alpha.toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground mt-1">vs benchmark</p>
                </Card>

                <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Activity className="h-4 w-4 text-primary" />
                        <p className="text-xs text-muted-foreground">Sortino</p>
                    </div>
                    <p className="text-2xl font-bold">{strategy.sortino.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Downside risk</p>
                </Card>
            </div>

            {/* Equity Curve */}
            <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className="font-bold text-lg">Equity Curve</h3>
                        <p className="text-sm text-muted-foreground">
                            Portfolio value vs S&P 500 benchmark
                        </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-primary"></div>
                            <span>Strategy</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-muted-foreground"></div>
                            <span>Benchmark</span>
                        </div>
                    </div>
                </div>
                <ResponsiveContainer width="100%" height={350}>
                    <AreaChart data={strategy.equityCurve}>
                        <defs>
                            <linearGradient id="colorPortfolio" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#17cf54" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#17cf54" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis
                            dataKey="date"
                            stroke="var(--muted-foreground)"
                            fontSize={12}
                            tickLine={false}
                        />
                        <YAxis
                            stroke="var(--muted-foreground)"
                            fontSize={12}
                            tickLine={false}
                            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'var(--card)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                            }}
                            formatter={(value: number | undefined) => (value !== undefined ? `$${value.toLocaleString()}` : '')}
                        />
                        <Area
                            type="monotone"
                            dataKey="portfolio"
                            stroke="#17cf54"
                            strokeWidth={2}
                            fill="url(#colorPortfolio)"
                            name="Strategy"
                        />
                        <Line
                            type="monotone"
                            dataKey="benchmark"
                            stroke="var(--muted-foreground)"
                            strokeWidth={2}
                            dot={false}
                            name="Benchmark"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </Card>

            {/* Additional Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-6">
                    <h3 className="font-bold text-lg mb-4">Performance Summary</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Initial Capital</span>
                            <span className="font-medium">
                                ${strategy.initialCapital.toLocaleString()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Final Value</span>
                            <span className="font-medium">
                                ${strategy.finalValue.toLocaleString()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">CAGR</span>
                            <span className="font-medium text-primary">{cagr}%</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Total Trades</span>
                            <span className="font-medium">{strategy.totalTrades}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Avg Win</span>
                            <span className="font-medium text-primary">
                                ${strategy.avgWin.toLocaleString()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Avg Loss</span>
                            <span className="font-medium text-destructive">
                                ${strategy.avgLoss.toLocaleString()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Profit Factor</span>
                            <span className="font-medium">{strategy.profitFactor.toFixed(2)}</span>
                        </div>
                    </div>
                </Card>

                <Card className="p-6">
                    <h3 className="font-bold text-lg mb-4">Risk Metrics</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Sharpe Ratio</span>
                            <span className="font-medium">{strategy.sharpeRatio.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Sortino Ratio</span>
                            <span className="font-medium">{strategy.sortino.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Max Drawdown</span>
                            <span className="font-medium text-destructive">
                                {strategy.maxDrawdown.toFixed(1)}%
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Alpha</span>
                            <span className="font-medium text-primary">
                                {strategy.alpha.toFixed(1)}%
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-sm text-muted-foreground">Win Rate</span>
                            <span className="font-medium">{strategy.winRate.toFixed(1)}%</span>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Robustness Analysis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Monte Carlo Simulation */}
                <Card className="p-6">
                    <h3 className="font-bold text-lg mb-4">Monte Carlo Simulation</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        1,000 simulations with random entry timing
                    </p>
                    <div className="space-y-2">
                        {strategy.monteCarloResults.map((result, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between p-3 rounded-lg border border-border"
                            >
                                <div>
                                    <p className="font-medium text-sm">{result.percentile}</p>
                                    <p className="text-xs text-muted-foreground">
                                        CAGR: {result.cagr.toFixed(1)}%
                                    </p>
                                </div>
                                <p className="font-bold">${(result.finalValue / 1000).toFixed(1)}K</p>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Regime Analysis */}
                <Card className="p-6">
                    <h3 className="font-bold text-lg mb-4">Regime Analysis</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        Performance across market conditions
                    </p>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={strategy.regimeAnalysis}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis
                                dataKey="regime"
                                stroke="var(--muted-foreground)"
                                fontSize={12}
                                tickLine={false}
                            />
                            <YAxis
                                stroke="var(--muted-foreground)"
                                fontSize={12}
                                tickLine={false}
                                tickFormatter={(value) => `${value}%`}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'var(--card)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '8px',
                                }}
                                formatter={(value: number | undefined) => (value !== undefined ? `${value.toFixed(1)}%` : '')}
                            />
                            <Bar dataKey="returns" fill="#17cf54" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-4 space-y-2">
                        {strategy.regimeAnalysis.map((regime, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between text-sm"
                            >
                                <span className="text-muted-foreground">{regime.regime}</span>
                                <div className="flex items-center gap-3">
                                    <span className="font-medium">
                                        {regime.returns > 0 ? '+' : ''}
                                        {regime.returns.toFixed(1)}%
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        Sharpe: {regime.sharpe.toFixed(2)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {regime.trades} trades
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
}
