'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Filter, Download, Plus, X, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface Holding {
    id: string;
    symbol: string;
    name: string;
    price: number;
    quantity: number;
    totalValue: number;
    avgCost: number;
    totalReturn: number;
    returnPercentage: number;
    trend: number[];
    account: string;
    strategy: string;
    tags: string[];
}

const mockHoldings: Holding[] = [
    {
        id: '1',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        price: 173.45,
        quantity: 150,
        totalValue: 26017.50,
        avgCost: 145.00,
        totalReturn: 4267.50,
        returnPercentage: 19.6,
        trend: [140, 145, 150, 148, 155, 160, 165, 170, 173],
        account: 'Fidelity Individual',
        strategy: 'Growth Tech',
        tags: ['High Conviction', 'VCP Setup'],
    },
    {
        id: '2',
        symbol: 'TSLA',
        name: 'Tesla, Inc.',
        price: 212.08,
        quantity: 85,
        totalValue: 18026.80,
        avgCost: 190.50,
        totalReturn: 1834.30,
        returnPercentage: 11.3,
        trend: [180, 175, 185, 190, 195, 200, 205, 210, 212],
        account: 'Vanguard Roth IRA',
        strategy: 'Momentum Trading',
        tags: ['FOMO', 'Earnings Play'],
    },
];

const accounts = ['All Accounts', 'Fidelity Individual', 'Vanguard Roth IRA', 'Robinhood Trading'];
const strategies = ['All Strategies', 'Growth Tech', 'Value Investing', 'Momentum Trading'];
const tags = ['All Tags', 'High Conviction', 'VCP Setup', 'Earnings Play', 'FOMO'];

import { Suspense } from 'react';

function CurrentHoldingsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [selectedAccount, setSelectedAccount] = useState(() => {
        const param = searchParams.get('account');
        if (param === '1') return 'Fidelity Individual';
        if (param === '2') return 'Vanguard Roth IRA';
        if (param === '3') return 'Robinhood Trading';
        return 'All Accounts';
    });

    const [selectedStrategy, setSelectedStrategy] = useState(() => {
        const param = searchParams.get('strategy');
        if (param === '1') return 'Growth Tech';
        if (param === '2') return 'Value Investing';
        if (param === '3') return 'Momentum Trading';
        return 'All Strategies';
    });

    const [selectedTag, setSelectedTag] = useState(() => {
        const param = searchParams.get('tag');
        if (param === '1') return 'High Conviction';
        if (param === '2') return 'VCP Setup';
        if (param === '3') return 'Earnings Play';
        if (param === '4') return 'FOMO';
        return 'All Tags';
    });

    const [showFilters, setShowFilters] = useState(() => {
        return !!(searchParams.get('account') || searchParams.get('strategy') || searchParams.get('tag'));
    });

    const filteredHoldings = mockHoldings.filter((holding) => {
        const accountMatch = selectedAccount === 'All Accounts' || holding.account === selectedAccount;
        const strategyMatch = selectedStrategy === 'All Strategies' || holding.strategy === selectedStrategy;
        const tagMatch = selectedTag === 'All Tags' || holding.tags.includes(selectedTag);
        return accountMatch && strategyMatch && tagMatch;
    });

    const clearFilters = () => {
        setSelectedAccount('All Accounts');
        setSelectedStrategy('All Strategies');
        setSelectedTag('All Tags');
    };

    const activeFiltersCount = [selectedAccount, selectedStrategy, selectedTag].filter(
        (filter, index) => filter !== ['All Accounts', 'All Strategies', 'All Tags'][index]
    ).length;

    const handleHoldingDoubleClick = (symbol: string) => {
        router.push(`/portfolios/detail/${symbol}`);
    };

    // Determine if filters are active
    const hasActiveFilters = activeFiltersCount > 0;
    const getFilterText = () => {
        if (selectedAccount !== 'All Accounts') return selectedAccount;
        if (selectedStrategy !== 'All Strategies') return selectedStrategy;
        if (selectedTag !== 'All Tags') return selectedTag;
        return '';
    };

    return (
        <div className="space-y-6 p-6">
            {/* Breadcrumb */}
            {hasActiveFilters && (
                <div className="flex items-center gap-2 text-sm">
                    <button
                        onClick={() => router.push('/portfolios')}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Portfolio
                    </button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    <span className="text-foreground font-medium">{getFilterText()}</span>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Current Holdings</h1>
                    <p className="text-muted-foreground">Snapshot as of today</p>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Net Account Value</p>
                    <h3 className="text-2xl font-bold text-primary">$1,130,792.85</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Net Realized P&L</p>
                    <h3 className="text-2xl font-bold text-primary">$222,525.00</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Starting Account Balance</p>
                    <h3 className="text-2xl font-bold">$0.00</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Deposits</p>
                    <h3 className="text-2xl font-bold">$0.00</h3>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Deployed Capital</p>
                    <h3 className="text-2xl font-bold">$1,135,591.98</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Available Cash</p>
                    <h3 className="text-2xl font-bold">$0.00</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Withdrawn</p>
                    <h3 className="text-2xl font-bold text-muted-foreground">$0.00</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Open Risk <span className="text-destructive">(+7%)</span></p>
                    <h3 className="text-2xl font-bold">$53,291.98</h3>
                </Card>
            </div>

            {/* Detailed Holdings */}
            <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold">Detailed Holdings</h3>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
                            <Filter className="h-4 w-4 mr-2" />
                            Filter
                        </Button>
                        <Button variant="outline" size="sm">
                            <Download className="h-4 w-4 mr-2" />
                            Export
                        </Button>
                    </div>
                </div>

                {/* Filter Panel */}
                {showFilters && (
                    <div className="mb-4">
                        <div className="flex items-center gap-2">
                            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                                <SelectTrigger className="w-40">
                                    <SelectValue placeholder="Account">{selectedAccount}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {accounts.map((account) => (
                                        <SelectItem key={account} value={account}>
                                            {account}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={selectedStrategy} onValueChange={setSelectedStrategy}>
                                <SelectTrigger className="w-40">
                                    <SelectValue placeholder="Strategy">{selectedStrategy}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {strategies.map((strategy) => (
                                        <SelectItem key={strategy} value={strategy}>
                                            {strategy}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={selectedTag} onValueChange={setSelectedTag}>
                                <SelectTrigger className="w-40">
                                    <SelectValue placeholder="Tag">{selectedTag}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {tags.map((tag) => (
                                        <SelectItem key={tag} value={tag}>
                                            {tag}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {activeFiltersCount > 0 && (
                                <Button size="sm" variant="destructive" onClick={clearFilters}>
                                    <X className="h-4 w-4 mr-2" />
                                    Clear Filters
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Holdings Table */}
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-accent/50">
                            <tr>
                                <th className="text-left py-4 px-4 text-xs text-muted-foreground font-medium">ASSET</th>
                                <th className="text-right py-4 px-4 text-xs text-muted-foreground font-medium">PRICE</th>
                                <th className="text-right py-4 px-4 text-xs text-muted-foreground font-medium">QUANTITY</th>
                                <th className="text-right py-4 px-4 text-xs text-muted-foreground font-medium">TOTAL VALUE</th>
                                <th className="text-right py-4 px-4 text-xs text-muted-foreground font-medium">AVG COST</th>
                                <th className="text-right py-4 px-4 text-xs text-muted-foreground font-medium">TOTAL RETURN</th>
                                <th className="text-center py-4 px-4 text-xs text-muted-foreground font-medium">TREND</th>
                                <th className="py-4 px-4"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredHoldings.map((holding) => (
                                <tr
                                    key={holding.id}
                                    className="border-t border-border hover:bg-accent/30 transition-colors cursor-pointer"
                                    onDoubleClick={() => handleHoldingDoubleClick(holding.symbol)}
                                >
                                    <td className="py-4 px-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                                                <span className="text-xs font-bold">{holding.symbol.slice(0, 2)}</span>
                                            </div>
                                            <div>
                                                <p className="font-medium">{holding.name}</p>
                                                <p className="text-sm text-muted-foreground">{holding.symbol}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-4 px-4 text-right font-medium">${holding.price.toFixed(2)}</td>
                                    <td className="py-4 px-4 text-right">{holding.quantity}</td>
                                    <td className="py-4 px-4 text-right font-medium">${holding.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="py-4 px-4 text-right">${holding.avgCost.toFixed(2)}</td>
                                    <td className="py-4 px-4 text-right">
                                        <div>
                                            <p className="font-medium text-primary">+${holding.totalReturn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                            <p className="text-xs text-primary">+{holding.returnPercentage}%</p>
                                        </div>
                                    </td>
                                    <td className="py-4 px-4">
                                        <div className="flex items-center justify-center">
                                            <svg width="80" height="30" className="text-primary">
                                                <polyline
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    points={holding.trend
                                                        .map((value, i) => {
                                                            const x = (i / (holding.trend.length - 1)) * 80;
                                                            const min = Math.min(...holding.trend);
                                                            const max = Math.max(...holding.trend);
                                                            const y = 25 - ((value - min) / (max - min)) * 20;
                                                            return `${x},${y}`;
                                                        })
                                                        .join(' ')}
                                                />
                                            </svg>
                                        </div>
                                    </td>
                                    <td className="py-4 px-4">
                                        <Button size="sm" className="rounded-full w-10 h-10 p-0">
                                            <Plus className="h-5 w-5" />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}

export default function CurrentHoldingsPage() {
    return (
        <Suspense fallback={<div>Loading holdings...</div>}>
            <CurrentHoldingsContent />
        </Suspense>
    );
}
