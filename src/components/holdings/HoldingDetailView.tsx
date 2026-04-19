'use client';

import { useState } from 'react';
import { Bell, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useRouter } from 'next/navigation';

export interface AccountPosition {
    portfolioId: string;
    name: string;
    shares: number;
    avgCost: number;
    value: number;
    gain: number;
}

export interface HoldingDetail {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    totalShares: number;
    totalEquity: number;
    avgCost: number;
    costBasis: number;
    totalReturn: number;
    returnPercent: number;
    accounts: AccountPosition[];
    priceHistory: Array<{ date: string; price: number }>;
}

export function HoldingDetailView({ holding }: { holding: HoldingDetail }) {
    const router = useRouter();
    const [selectedPeriod, setSelectedPeriod] = useState('1M');
    const gainIsPositive = holding.totalReturn >= 0;

    return (
        <div className="space-y-6 p-6">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <button onClick={() => router.push('/portfolios')} className="hover:text-foreground transition-colors">Portfolio</button>
                <span>›</span>
                <button onClick={() => router.push('/portfolios/holdings')} className="hover:text-foreground transition-colors">Current Holdings</button>
                <span>›</span>
                <span className="text-foreground font-medium">{holding.symbol}</span>
            </div>

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-1">
                        {holding.name} ({holding.symbol})
                    </h1>
                    <div className="flex items-center gap-4 mb-4">
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-bold">${holding.price.toFixed(2)}</span>
                            <Badge
                                variant="default"
                                className={holding.change >= 0 ? 'bg-primary text-primary-foreground' : 'bg-destructive text-destructive-foreground'}
                            >
                                {holding.change >= 0 ? '+' : ''}{holding.changePercent.toFixed(2)}% (${holding.change.toFixed(2)})
                            </Badge>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                        <Bell className="h-4 w-4 mr-2" />
                        Alert
                    </Button>
                    <Button className="bg-primary hover:bg-primary/90">
                        <Plus className="h-4 w-4 mr-2" />
                        Trade
                    </Button>
                </div>
            </div>

            {/* Position Summary — Per-symbol breakdown and cost basis */}
            <Card className="p-6">
                <h3 className="font-bold text-lg mb-4">Position Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-xs text-muted-foreground mb-1">Total Shares</p>
                        <p className="text-lg font-bold">{holding.totalShares.toLocaleString()}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-xs text-muted-foreground mb-1">Market Value</p>
                        <p className="text-lg font-bold">${holding.totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-xs text-muted-foreground mb-1">Avg Cost</p>
                        <p className="text-lg font-bold">${holding.avgCost.toFixed(2)}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-xs text-muted-foreground mb-1">Cost Basis</p>
                        <p className="text-lg font-bold">${holding.costBasis.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-xs text-muted-foreground mb-1">Total Return</p>
                        <p className={`text-lg font-bold ${gainIsPositive ? 'text-primary' : 'text-destructive'}`}>
                            {gainIsPositive ? '+' : ''}${holding.totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-xs text-muted-foreground mb-1">Return %</p>
                        <p className={`text-lg font-bold ${gainIsPositive ? 'text-primary' : 'text-destructive'}`}>
                            {gainIsPositive ? '+' : ''}{holding.returnPercent.toFixed(2)}%
                        </p>
                    </div>
                </div>
            </Card>

            {/* Price History Chart */}
            {holding.priceHistory.length > 0 && (
                <Card className="p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="font-bold text-lg">Price History</h3>
                        <div className="flex items-center gap-2">
                            {['1D', '1W', '1M', '1Y', 'ALL'].map((period) => (
                                <button
                                    key={period}
                                    onClick={() => setSelectedPeriod(period)}
                                    className={`px-3 py-1 rounded-lg text-sm transition-colors ${selectedPeriod === period
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-accent'
                                        }`}
                                >
                                    {period}
                                </button>
                            ))}
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={holding.priceHistory}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis
                                dataKey="date"
                                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                                axisLine={{ stroke: 'var(--border)' }}
                                tickLine={false}
                            />
                            <YAxis
                                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                domain={['dataMin - 5', 'dataMax + 5']}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: 'var(--card)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '8px',
                                }}
                                labelStyle={{ color: 'var(--foreground)' }}
                                formatter={(value: number | undefined) => (value !== undefined ? [`$${value.toFixed(2)}`, 'Price'] : ['-', 'Price'])}
                            />
                            <Line
                                type="monotone"
                                dataKey="price"
                                stroke="#17cf54"
                                strokeWidth={2}
                                dot={{ fill: '#17cf54', r: 4 }}
                                activeDot={{ r: 6 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </Card>
            )}

            {/* Account Breakdown */}
            <Card className="p-6">
                <h3 className="font-bold text-lg mb-4">Holdings by Account</h3>
                <div className="space-y-3">
                    {holding.accounts.map((account) => (
                        <div
                            key={account.portfolioId}
                            className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-primary/40 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold">
                                    {account.name.charAt(0)}
                                </div>
                                <div>
                                    <p className="font-medium">{account.name}</p>
                                    <p className="text-sm text-muted-foreground">
                                        {account.shares.toLocaleString()} shares @ ${account.avgCost.toFixed(2)}
                                    </p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="font-medium">${account.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                <p className={`text-sm ${account.gain >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                    {account.gain >= 0 ? '+' : ''}${account.gain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}
