'use client';

import { useState } from 'react';
import { Share2, Download, TrendingUp, TrendingDown, Clock, Globe, BarChart2, Bell, Plus } from "lucide-react";
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { useRouter, useParams } from 'next/navigation';

export default function PortfolioDetailPage() {
    const router = useRouter();
    const params = useParams();
    const [selectedPeriod, setSelectedPeriod] = useState('1M');

    // Extract symbol from URL path
    const symbol = params.symbol as string || '';

    // Mock data for the stock detail view
    const stockData = {
        AAPL: {
            symbol: 'AAPL',
            name: 'Apple Inc.',
            exchange: 'NASDAQ',
            price: 175.43,
            change: 2.17,
            changePercent: 1.25,
            totalShares: 15,
            totalEquity: 2631.45,
            avgCost: 145.00,
            open: 174.00,
            high: 176.00,
            low: 173.50,
            volume: '54.2M',
            accounts: [
                { name: 'Fidelity', shares: 10, value: 1754.30, gain: 304.30 },
                { name: 'Robinhood', shares: 5, value: 877.15, gain: 152.15 },
            ],
            relatedNews: [
                {
                    title: 'Apple announces new Vision Pro headset release date',
                    source: 'TechCrunch',
                    time: '2h ago',
                },
                {
                    title: 'Q3 Earnings Preview: What to expect from big tech',
                    source: 'Bloomberg',
                    time: '5h ago',
                },
                {
                    title: 'Why analysts are raising their price targets on AAPL',
                    source: 'WSJ',
                    time: '1d ago',
                },
                {
                    title: 'Supply chain updates: Foxconn ramps up production',
                    source: 'Reuters',
                    time: '1d ago',
                },
            ],
            analystRating: 'Buy',
            analystCount: 32,
            dividend: '0.52%',
            nextPayoutDate: 'Nov 15',
        },
        TSLA: {
            symbol: 'TSLA',
            name: 'Tesla, Inc.',
            exchange: 'NASDAQ',
            price: 212.08,
            change: 4.52,
            changePercent: 2.18,
            totalShares: 85,
            totalEquity: 18026.80,
            avgCost: 190.50,
            open: 209.00,
            high: 213.50,
            low: 208.00,
            volume: '42.8M',
            accounts: [
                { name: 'Fidelity', shares: 85, value: 18026.80, gain: 1834.30 },
            ],
            relatedNews: [],
            analystRating: 'Hold',
            analystCount: 24,
            dividend: '0.00%',
            nextPayoutDate: 'N/A',
        },
    };

    const stock = stockData[symbol as keyof typeof stockData];

    if (!stock) {
        return (
            <div className="flex h-full items-center justify-center p-12">
                <p className="text-muted-foreground">Stock not found. Try AAPL or TSLA.</p>
            </div>
        );
    }

    const priceHistory = [
        { date: 'Oct 01', price: 165.50 },
        { date: 'Oct 08', price: 163.00 },
        { date: 'Oct 15', price: 168.20 },
        { date: 'Oct 22', price: 172.30 },
        { date: 'Oct 29', price: 175.43 },
    ];

    return (
        <div className="space-y-6 p-6">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <button onClick={() => router.push('/portfolios')} className="hover:text-foreground transition-colors">Portfolio</button>
                <span>›</span>
                <button onClick={() => router.push('/portfolios/holdings')} className="hover:text-foreground transition-colors">Current Holdings</button>
                <span>›</span>
                <span className="text-foreground font-medium">{stock.symbol}</span>
            </div>

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-1">
                        {stock.name} ({stock.symbol})
                    </h1>
                    <div className="flex items-center gap-4 mb-4">
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-bold">${stock.price.toFixed(2)}</span>
                            <Badge variant="default" className="bg-primary text-primary-foreground">
                                +{stock.changePercent}% (${stock.change})
                            </Badge>
                        </div>
                        <span className="text-sm text-muted-foreground">{stock.exchange}</span>
                        <span className="text-sm text-muted-foreground">Today</span>
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

            {/* Price History Chart */}
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
                    <LineChart data={priceHistory}>
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

                {/* OHLV Stats */}
                <div className="grid grid-cols-4 gap-4 mt-6">
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-sm text-muted-foreground mb-1">Open</p>
                        <p className="text-lg font-bold">${stock.open.toFixed(2)}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-sm text-muted-foreground mb-1">High</p>
                        <p className="text-lg font-bold">${stock.high.toFixed(2)}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-sm text-muted-foreground mb-1">Low</p>
                        <p className="text-lg font-bold">${stock.low.toFixed(2)}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-accent/30">
                        <p className="text-sm text-muted-foreground mb-1">Volume</p>
                        <p className="text-lg font-bold">{stock.volume}</p>
                    </div>
                </div>
            </Card>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - Your Position */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-lg">Your Position</h3>
                            <button className="text-sm text-primary hover:underline">View All</button>
                        </div>

                        {/* Position Summary */}
                        <div className="grid grid-cols-3 gap-4 mb-6 p-4 rounded-lg bg-accent/30">
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">Total Equity</p>
                                <p className="text-xl font-bold">${stock.totalEquity.toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">Total Shares</p>
                                <p className="text-xl font-bold">{stock.totalShares}</p>
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground mb-1">Avg Cost</p>
                                <p className="text-xl font-bold">${stock.avgCost.toFixed(2)}</p>
                            </div>
                        </div>

                        {/* Account Breakdown */}
                        <div>
                            <h4 className="font-medium text-sm mb-3 text-muted-foreground">ACCOUNT</h4>
                            <div className="space-y-3">
                                {stock.accounts.map((account, index) => (
                                    <div key={index} className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-primary/40 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold">
                                                {account.name.charAt(0)}
                                            </div>
                                            <div>
                                                <p className="font-medium">{account.name}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    {account.shares} shares
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-medium">${account.value.toFixed(2)}</p>
                                            <p className="text-sm text-primary">+${account.gain.toFixed(2)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Card>

                    {/* Analyst Rating and Dividends */}
                    <div className="grid grid-cols-2 gap-6">
                        <Card className="p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                </div>
                                <h4 className="font-bold">Analyst Rating</h4>
                            </div>
                            <p className="text-2xl font-bold text-primary mb-1">{stock.analystRating}</p>
                            <p className="text-sm text-muted-foreground">Based on {stock.analystCount} analysts</p>
                            <div className="mt-4 h-2 bg-accent rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-destructive via-muted to-primary" style={{ width: '75%' }}></div>
                            </div>
                        </Card>

                        <Card className="p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <h4 className="font-bold">Dividends</h4>
                            </div>
                            <p className="text-2xl font-bold text-primary mb-1">{stock.dividend}</p>
                            <p className="text-sm text-muted-foreground">Next Payout</p>
                            <p className="text-sm font-medium mt-1">{stock.nextPayoutDate}</p>
                        </Card>
                    </div>
                </div>

                {/* Right Column - Related News */}
                <div>
                    <Card className="p-6">
                        <h3 className="font-bold text-lg mb-4">Related News</h3>
                        <div className="space-y-4">
                            {stock.relatedNews.length > 0 ? (
                                stock.relatedNews.map((news, index) => (
                                    <div
                                        key={index}
                                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer"
                                    >
                                        <div className="flex-shrink-0 w-16 h-16 bg-primary/10 rounded-lg"></div>
                                        <div className="flex-1">
                                            <h4 className="font-medium text-sm mb-1 line-clamp-2">{news.title}</h4>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <span>{news.source}</span>
                                                <span>•</span>
                                                <span>{news.time}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-muted-foreground text-center py-8">No news available</p>
                            )}
                        </div>
                        <Button variant="ghost" className="w-full mt-4">
                            View All News
                        </Button>
                    </Card>
                </div>
            </div>
        </div>
    );
}
