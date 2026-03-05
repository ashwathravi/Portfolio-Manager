'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Play, Pause, TrendingUp, Activity } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Strategy {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'paused' | 'backtesting';
    returns: number;
    sharpe: number;
    winRate: number;
    totalTrades: number;
}

const INITIAL_STRATEGIES: Strategy[] = [
    {
        id: '1',
        name: 'Momentum + Value',
        description: 'Long positions in stocks with strong momentum and low P/E ratios',
        status: 'active',
        returns: 18.45,
        sharpe: 1.92,
        winRate: 64.5,
        totalTrades: 127,
    },
    {
        id: '2',
        name: 'Mean Reversion',
        description: 'Short-term trades on oversold conditions with RSI < 30',
        status: 'paused',
        returns: 12.34,
        sharpe: 1.45,
        winRate: 58.2,
        totalTrades: 203,
    },
    {
        id: '3',
        name: 'Sector Rotation',
        description: 'Monthly rotation based on relative strength indicators',
        status: 'backtesting',
        returns: 0,
        sharpe: 0,
        winRate: 0,
        totalTrades: 0,
    },
];

export default function StrategiesPage() {
    const router = useRouter();
    const [strategies, setStrategies] = useState<Strategy[]>(INITIAL_STRATEGIES);

    // Computed stats from live state
    const activeCount  = strategies.filter((s) => s.status === 'active').length;
    const liveStrategies = strategies.filter((s) => s.returns > 0);
    const avgReturn    = liveStrategies.length > 0
        ? liveStrategies.reduce((sum, s) => sum + s.returns, 0) / liveStrategies.length
        : 0;
    const avgSharpe    = liveStrategies.length > 0
        ? liveStrategies.reduce((sum, s) => sum + s.sharpe, 0) / liveStrategies.length
        : 0;
    const totalTrades  = strategies.reduce((sum, s) => sum + s.totalTrades, 0);

    function toggleStatus(id: string) {
        setStrategies((prev) =>
            prev.map((s) => {
                if (s.id !== id) return s;
                if (s.status === 'active') return { ...s, status: 'paused' };
                if (s.status === 'paused') return { ...s, status: 'active' };
                // backtesting → simulate run starting
                return { ...s, status: 'paused' };
            })
        );
    }

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Strategies</h1>
                    <p className="text-muted-foreground">
                        Build, backtest, and monitor your trading strategies
                    </p>
                </div>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    New Strategy
                </Button>
            </div>

            {/* Overview Stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Active Strategies</p>
                            <h2 className="text-2xl font-bold">{activeCount}</h2>
                            <p className="text-xs text-muted-foreground">Currently running</p>
                        </div>
                        <div className="p-3 bg-primary/10 rounded-full">
                            <Activity className="h-6 w-6 text-primary" />
                        </div>
                    </div>
                </Card>

                <Card className="p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Avg Return</p>
                            <h2 className="text-2xl font-bold text-green-600">+{avgReturn.toFixed(2)}%</h2>
                            <p className="text-xs text-muted-foreground">Across all strategies</p>
                        </div>
                        <div className="p-3 bg-green-100 rounded-full">
                            <TrendingUp className="h-6 w-6 text-green-600" />
                        </div>
                    </div>
                </Card>

                <Card className="p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Avg Sharpe Ratio</p>
                            <h2 className="text-2xl font-bold">{avgSharpe.toFixed(2)}</h2>
                            <p className="text-xs text-muted-foreground">Risk-adjusted</p>
                        </div>
                    </div>
                </Card>

                <Card className="p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Total Trades</p>
                            <h2 className="text-2xl font-bold">{totalTrades}</h2>
                            <p className="text-xs text-muted-foreground">All time</p>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Strategies List */}
            <div className="space-y-4">
                <h2 className="text-xl font-semibold">Your Strategies</h2>
                {strategies.map((strategy) => (
                    <Card key={strategy.id} className="p-6">
                        <div className="flex items-start justify-between">
                            <div className="flex-1 space-y-4">
                                <div>
                                    <div className="flex items-center gap-3">
                                        <h3 className="font-semibold">{strategy.name}</h3>
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
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {strategy.description}
                                    </p>
                                </div>

                                {strategy.returns > 0 && (
                                    <div className="grid gap-4 sm:grid-cols-4">
                                        <div>
                                            <p className="text-sm text-muted-foreground">Total Return</p>
                                            <p className="text-lg font-semibold text-green-600">
                                                +{strategy.returns.toFixed(2)}%
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-muted-foreground">Sharpe Ratio</p>
                                            <p className="text-lg font-semibold">{strategy.sharpe.toFixed(2)}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-muted-foreground">Win Rate</p>
                                            <p className="text-lg font-semibold">{strategy.winRate.toFixed(1)}%</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-muted-foreground">Total Trades</p>
                                            <p className="text-lg font-semibold">{strategy.totalTrades}</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="ml-4 flex gap-2">
                                {strategy.status === 'active' ? (
                                    <Button variant="outline" size="sm" onClick={() => toggleStatus(strategy.id)}>
                                        <Pause className="mr-2 h-4 w-4" />
                                        Pause
                                    </Button>
                                ) : strategy.status === 'paused' ? (
                                    <Button variant="outline" size="sm" onClick={() => toggleStatus(strategy.id)}>
                                        <Play className="mr-2 h-4 w-4" />
                                        Resume
                                    </Button>
                                ) : (
                                    <Button variant="outline" size="sm" onClick={() => router.push(`/strategies/${strategy.id}/backtest`)}>
                                        <Play className="mr-2 h-4 w-4" />
                                        Run Backtest
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => router.push(`/strategies/${strategy.id}`)}
                                >
                                    View Details
                                </Button>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            {/* Strategy Builder CTA */}
            <Card className="border-dashed p-12 text-center">
                <h3 className="text-xl font-semibold">Build Your First Strategy</h3>
                <p className="mt-2 text-muted-foreground">
                    Use our visual strategy builder to create custom trading algorithms
                </p>
                <Button className="mt-4" onClick={() => router.push('/strategies/builder')}>
                    <Plus className="mr-2 h-4 w-4" />
                    Open Strategy Builder
                </Button>
            </Card>
        </div>
    );
}
