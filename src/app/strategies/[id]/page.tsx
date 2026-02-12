'use client';

import { useState } from 'react';
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

interface StrategyDetailData {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'paused' | 'backtesting';
    backtestPeriod: string;
    initialCapital: number;
    finalValue: number;
    netProfit: number;
    netProfitPercent: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    alpha: number;
    sortino: number;
    totalTrades: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    equityCurve: Array<{
        date: string;
        portfolio: number;
        benchmark: number;
    }>;
    monteCarloResults: Array<{
        percentile: string;
        finalValue: number;
        cagr: number;
    }>;
    regimeAnalysis: Array<{
        regime: string;
        returns: number;
        sharpe: number;
        trades: number;
    }>;
}

const mockStrategyData: Record<string, StrategyDetailData> = {
    '1': {
        id: '1',
        name: 'Momentum + Value',
        description: 'Long positions in stocks with strong momentum and low P/E ratios',
        status: 'active',
        backtestPeriod: 'Jan 2020 - Feb 2024',
        initialCapital: 100000,
        finalValue: 164500,
        netProfit: 64500,
        netProfitPercent: 64.5,
        sharpeRatio: 1.92,
        maxDrawdown: -18.4,
        winRate: 64.5,
        alpha: 8.2,
        sortino: 2.45,
        totalTrades: 127,
        avgWin: 3850,
        avgLoss: -1920,
        profitFactor: 2.15,
        equityCurve: [
            { date: 'Jan 2020', portfolio: 100000, benchmark: 100000 },
            { date: 'Apr 2020', portfolio: 88500, benchmark: 92000 },
            { date: 'Jul 2020', portfolio: 105200, benchmark: 98500 },
            { date: 'Oct 2020', portfolio: 112800, benchmark: 104200 },
            { date: 'Jan 2021', portfolio: 121500, benchmark: 108900 },
            { date: 'Apr 2021', portfolio: 128900, benchmark: 115600 },
            { date: 'Jul 2021', portfolio: 135400, benchmark: 120800 },
            { date: 'Oct 2021', portfolio: 142100, benchmark: 126300 },
            { date: 'Jan 2022', portfolio: 138200, benchmark: 122100 },
            { date: 'Apr 2022', portfolio: 132800, benchmark: 115400 },
            { date: 'Jul 2022', portfolio: 128600, benchmark: 110200 },
            { date: 'Oct 2022', portfolio: 134500, benchmark: 112800 },
            { date: 'Jan 2023', portfolio: 142300, benchmark: 118500 },
            { date: 'Apr 2023', portfolio: 149800, benchmark: 125200 },
            { date: 'Jul 2023', portfolio: 155600, benchmark: 131800 },
            { date: 'Oct 2023', portfolio: 158900, benchmark: 134600 },
            { date: 'Jan 2024', portfolio: 162400, benchmark: 138200 },
            { date: 'Feb 2024', portfolio: 164500, benchmark: 140500 },
        ],
        monteCarloResults: [
            { percentile: '95th', finalValue: 185200, cagr: 16.8 },
            { percentile: '75th', finalValue: 172400, cagr: 14.5 },
            { percentile: '50th (Median)', finalValue: 164500, cagr: 13.2 },
            { percentile: '25th', finalValue: 155800, cagr: 11.6 },
            { percentile: '5th', finalValue: 142300, cagr: 9.2 },
        ],
        regimeAnalysis: [
            { regime: 'Bull Market', returns: 22.4, sharpe: 2.15, trades: 52 },
            { regime: 'Bear Market', returns: -8.2, sharpe: 1.12, trades: 28 },
            { regime: 'Sideways', returns: 6.8, sharpe: 1.65, trades: 47 },
        ],
    },
    '2': {
        id: '2',
        name: 'Mean Reversion',
        description: 'Short-term trades on oversold conditions with RSI < 30',
        status: 'paused',
        backtestPeriod: 'Jan 2020 - Feb 2024',
        initialCapital: 100000,
        finalValue: 149200,
        netProfit: 49200,
        netProfitPercent: 49.2,
        sharpeRatio: 1.45,
        maxDrawdown: -22.6,
        winRate: 58.2,
        alpha: 5.8,
        sortino: 1.92,
        totalTrades: 203,
        avgWin: 2820,
        avgLoss: -2140,
        profitFactor: 1.68,
        equityCurve: [
            { date: 'Jan 2020', portfolio: 100000, benchmark: 100000 },
            { date: 'Apr 2020', portfolio: 92300, benchmark: 92000 },
            { date: 'Jul 2020', portfolio: 102800, benchmark: 98500 },
            { date: 'Oct 2020', portfolio: 108500, benchmark: 104200 },
            { date: 'Jan 2021', portfolio: 115200, benchmark: 108900 },
            { date: 'Apr 2021', portfolio: 120600, benchmark: 115600 },
            { date: 'Jul 2021', portfolio: 125800, benchmark: 120800 },
            { date: 'Oct 2021', portfolio: 131200, benchmark: 126300 },
            { date: 'Jan 2022', portfolio: 128400, benchmark: 122100 },
            { date: 'Apr 2022', portfolio: 122800, benchmark: 115400 },
            { date: 'Jul 2022', portfolio: 119500, benchmark: 110200 },
            { date: 'Oct 2022', portfolio: 124800, benchmark: 112800 },
            { date: 'Jan 2023', portfolio: 131600, benchmark: 118500 },
            { date: 'Apr 2023', portfolio: 137900, benchmark: 125200 },
            { date: 'Jul 2023', portfolio: 142500, benchmark: 131800 },
            { date: 'Oct 2023', portfolio: 145800, benchmark: 134600 },
            { date: 'Jan 2024', portfolio: 148200, benchmark: 138200 },
            { date: 'Feb 2024', portfolio: 149200, benchmark: 140500 },
        ],
        monteCarloResults: [
            { percentile: '95th', finalValue: 168400, cagr: 14.2 },
            { percentile: '75th', finalValue: 158200, cagr: 12.5 },
            { percentile: '50th (Median)', finalValue: 149200, cagr: 11.1 },
            { percentile: '25th', finalValue: 141500, cagr: 9.5 },
            { percentile: '5th', finalValue: 128600, cagr: 6.8 },
        ],
        regimeAnalysis: [
            { regime: 'Bull Market', returns: 18.6, sharpe: 1.85, trades: 78 },
            { regime: 'Bear Market', returns: -5.4, sharpe: 0.92, trades: 52 },
            { regime: 'Sideways', returns: 8.2, sharpe: 1.42, trades: 73 },
        ],
    },
    '3': {
        id: '3',
        name: 'Sector Rotation',
        description: 'Monthly rotation based on relative strength indicators',
        status: 'backtesting',
        backtestPeriod: 'Jan 2020 - Feb 2024',
        initialCapital: 100000,
        finalValue: 156800,
        netProfit: 56800,
        netProfitPercent: 56.8,
        sharpeRatio: 1.68,
        maxDrawdown: -16.2,
        winRate: 61.4,
        alpha: 7.2,
        sortino: 2.18,
        totalTrades: 88,
        avgWin: 4250,
        avgLoss: -2380,
        profitFactor: 1.95,
        equityCurve: [
            { date: 'Jan 2020', portfolio: 100000, benchmark: 100000 },
            { date: 'Apr 2020', portfolio: 90200, benchmark: 92000 },
            { date: 'Jul 2020', portfolio: 104500, benchmark: 98500 },
            { date: 'Oct 2020', portfolio: 110800, benchmark: 104200 },
            { date: 'Jan 2021', portfolio: 118200, benchmark: 108900 },
            { date: 'Apr 2021', portfolio: 124600, benchmark: 115600 },
            { date: 'Jul 2021', portfolio: 130200, benchmark: 120800 },
            { date: 'Oct 2021', portfolio: 136800, benchmark: 126300 },
            { date: 'Jan 2022', portfolio: 133400, benchmark: 122100 },
            { date: 'Apr 2022', portfolio: 128200, benchmark: 115400 },
            { date: 'Jul 2022', portfolio: 125600, benchmark: 110200 },
            { date: 'Oct 2022', portfolio: 130500, benchmark: 112800 },
            { date: 'Jan 2023', portfolio: 137800, benchmark: 118500 },
            { date: 'Apr 2023', portfolio: 144200, benchmark: 125200 },
            { date: 'Jul 2023', portfolio: 149600, benchmark: 131800 },
            { date: 'Oct 2023', portfolio: 153200, benchmark: 134600 },
            { date: 'Jan 2024', portfolio: 155800, benchmark: 138200 },
            { date: 'Feb 2024', portfolio: 156800, benchmark: 140500 },
        ],
        monteCarloResults: [
            { percentile: '95th', finalValue: 178600, cagr: 15.8 },
            { percentile: '75th', finalValue: 166400, cagr: 13.6 },
            { percentile: '50th (Median)', finalValue: 156800, cagr: 12.2 },
            { percentile: '25th', finalValue: 148500, cagr: 10.5 },
            { percentile: '5th', finalValue: 135200, cagr: 7.9 },
        ],
        regimeAnalysis: [
            { regime: 'Bull Market', returns: 20.5, sharpe: 2.05, trades: 36 },
            { regime: 'Bear Market', returns: -6.8, sharpe: 1.05, trades: 22 },
            { regime: 'Sideways', returns: 7.5, sharpe: 1.58, trades: 30 },
        ],
    },
};

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
                    <Button size="sm">
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
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                            dataKey="date"
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                            tickLine={false}
                        />
                        <YAxis
                            stroke="hsl(var(--muted-foreground))"
                            fontSize={12}
                            tickLine={false}
                            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
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
                            stroke="hsl(var(--muted-foreground))"
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
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis
                                dataKey="regime"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={12}
                                tickLine={false}
                            />
                            <YAxis
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={12}
                                tickLine={false}
                                tickFormatter={(value) => `${value}%`}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'hsl(var(--card))',
                                    border: '1px solid hsl(var(--border))',
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
