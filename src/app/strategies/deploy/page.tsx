'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Rocket, ShieldCheck, Activity, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

const mockStrategies = [
    {
        id: '1',
        name: 'Momentum + Value',
        status: 'active' as const,
        returns: 18.45,
        sharpe: 1.92,
    },
    {
        id: '2',
        name: 'Mean Reversion',
        status: 'paused' as const,
        returns: 12.34,
        sharpe: 1.45,
    },
    {
        id: '3',
        name: 'Sector Rotation',
        status: 'backtesting' as const,
        returns: 0,
        sharpe: 0,
    },
];

const statusConfig = {
    active: { label: 'Live', icon: Activity, className: 'bg-primary/10 text-primary border-primary/20' },
    paused: { label: 'Paused', icon: AlertTriangle, className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
    backtesting: { label: 'Backtesting', icon: ShieldCheck, className: 'bg-muted text-muted-foreground border-border' },
};

export default function StrategyDeployPage() {
    return (
        <div>
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" asChild aria-label="Back to Strategies">
                        <Link href="/strategies">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Deploy Strategies</h1>
                        <p className="text-muted-foreground">Manage live and paper-trading deployments.</p>
                    </div>
                </div>

                <div className="grid gap-4">
                    {mockStrategies.map((strategy) => {
                        const cfg = statusConfig[strategy.status];
                        const StatusIcon = cfg.icon;
                        const canDeploy = strategy.status === 'backtesting';
                        const isLive = strategy.status === 'active';

                        return (
                            <Card key={strategy.id}>
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <CardTitle className="text-base">{strategy.name}</CardTitle>
                                            <Badge className={cfg.className}>
                                                <StatusIcon className="mr-1 h-3 w-3" />
                                                {cfg.label}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {isLive && (
                                                <Button variant="outline" size="sm">
                                                    Pause
                                                </Button>
                                            )}
                                            {strategy.status === 'paused' && (
                                                <Button variant="outline" size="sm">
                                                    Resume
                                                </Button>
                                            )}
                                            {canDeploy && (
                                                <Button size="sm">
                                                    <Rocket className="mr-2 h-4 w-4" />
                                                    Deploy Live
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <CardDescription className="flex gap-6 pt-1">
                                        <span>Return: <strong className="text-foreground">{strategy.returns > 0 ? `+${strategy.returns}%` : '—'}</strong></span>
                                        <span>Sharpe: <strong className="text-foreground">{strategy.sharpe > 0 ? strategy.sharpe : '—'}</strong></span>
                                    </CardDescription>
                                </CardHeader>
                            </Card>
                        );
                    })}
                </div>

                <Card className="border-dashed p-8 text-center">
                    <Rocket className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                    <h3 className="font-semibold mb-1">Ready to go live?</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        Complete backtesting before deploying a strategy to live trading.
                    </p>
                    <Button variant="outline" asChild>
                        <Link href="/strategies/builder">Build a New Strategy</Link>
                    </Button>
                </Card>
            </div>
        </div>
    );
}
