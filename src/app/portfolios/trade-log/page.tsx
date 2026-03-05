'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Filter, Download, Plus, ArrowUpRight, ArrowDownRight, X, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AddTradeModal } from '@/components/trade-log/AddTradeModal';
import { exportToCsv } from '@/lib/exportCsv';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

interface Trade {
    id: string;
    date: string;
    symbol: string;
    name: string;
    type: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    totalValue: number;
    account: string;
    status: 'completed' | 'pending' | 'failed';
    strategy: string;
    tags: string[];
}

const mockTrades: Trade[] = [
    {
        id: '1',
        date: '2026-02-06',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        type: 'BUY',
        quantity: 50,
        price: 173.45,
        totalValue: 8672.50,
        account: 'Fidelity Individual',
        status: 'completed',
        strategy: 'Growth Tech',
        tags: ['High Conviction', 'VCP Setup'],
    },
    {
        id: '2',
        date: '2026-02-06',
        symbol: 'TSLA',
        name: 'Tesla, Inc.',
        type: 'BUY',
        quantity: 30,
        price: 212.08,
        totalValue: 6362.40,
        account: 'Fidelity Individual',
        status: 'completed',
        strategy: 'Momentum Trading',
        tags: ['FOMO'],
    },
    {
        id: '3',
        date: '2026-02-05',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        type: 'BUY',
        quantity: 100,
        price: 170.00,
        totalValue: 17000.00,
        account: 'Fidelity Individual',
        status: 'completed',
        strategy: 'Growth Tech',
        tags: ['High Conviction'],
    },
    {
        id: '4',
        date: '2026-02-04',
        symbol: 'TSLA',
        name: 'Tesla, Inc.',
        type: 'BUY',
        quantity: 55,
        price: 205.50,
        totalValue: 11302.50,
        account: 'Vanguard Roth IRA',
        status: 'completed',
        strategy: 'Momentum Trading',
        tags: ['FOMO', 'Earnings Play'],
    },
    {
        id: '5',
        date: '2026-02-03',
        symbol: 'MSFT',
        name: 'Microsoft Corp.',
        type: 'SELL',
        quantity: 25,
        price: 420.75,
        totalValue: 10518.75,
        account: 'Fidelity Individual',
        status: 'completed',
        strategy: 'Value Investing',
        tags: ['High Conviction'],
    },
];

const accounts = ['All Accounts', 'Fidelity Individual', 'Vanguard Roth IRA', 'Robinhood Trading'];
const strategies = ['All Strategies', 'Growth Tech', 'Value Investing', 'Momentum Trading'];
const tags = ['All Tags', 'High Conviction', 'VCP Setup', 'Earnings Play', 'FOMO'];

import { Suspense } from 'react';

function TradeLogContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [trades, setTrades] = useState(mockTrades);
    const [showAddTrade, setShowAddTrade] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState<string>(() => {
        const accountParam = searchParams.get('account');
        return accountParam === '1' ? 'Fidelity Individual' : accountParam === '2' ? 'Vanguard Roth IRA' : accountParam === '3' ? 'Robinhood Trading' : 'All Accounts';
    });

    const [selectedStrategy, setSelectedStrategy] = useState<string>(() => {
        const strategyParam = searchParams.get('strategy');
        return strategyParam === '1' ? 'Momentum Strategy' : strategyParam === '2' ? 'Value Investing' : 'All Strategies';
    });

    const [selectedTag, setSelectedTag] = useState<string>(() => {
        const tagParam = searchParams.get('tag');
        return tagParam === '1' ? 'High Conviction' : tagParam === '2' ? 'VCP Setup' : tagParam === '3' ? 'Earnings Play' : tagParam === '4' ? 'FOMO' : 'All Tags';
    });

    const [showFilters, setShowFilters] = useState(() => {
        return !!(searchParams.get('account') || searchParams.get('strategy') || searchParams.get('tag'));
    });

    const filteredTrades = useMemo(() => {
        return trades.filter((trade) => {
            const accountMatch = selectedAccount === 'All Accounts' || trade.account === selectedAccount;
            const strategyMatch = selectedStrategy === 'All Strategies' || trade.strategy === selectedStrategy;
            const tagMatch = selectedTag === 'All Tags' || trade.tags.includes(selectedTag);
            return accountMatch && strategyMatch && tagMatch;
        });
    }, [trades, selectedAccount, selectedStrategy, selectedTag]);

    const summaryStats = useMemo(() => {
        return filteredTrades.reduce(
            (acc, trade) => {
                if (trade.type === 'BUY') {
                    acc.totalBuyVolume += trade.totalValue;
                } else if (trade.type === 'SELL') {
                    acc.totalSellVolume += trade.totalValue;
                }
                return acc;
            },
            { totalBuyVolume: 0, totalSellVolume: 0 }
        );
    }, [filteredTrades]);

    const clearFilters = () => {
        setSelectedAccount('All Accounts');
        setSelectedStrategy('All Strategies');
        setSelectedTag('All Tags');
    };

    const activeFiltersCount = [selectedAccount, selectedStrategy, selectedTag].filter(
        (filter, index) => filter !== ['All Accounts', 'All Strategies', 'All Tags'][index]
    ).length;

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
                    <h1 className="text-3xl font-bold tracking-tight">Trade Log</h1>
                    <p className="text-muted-foreground">
                        Record of all transactions across all accounts
                    </p>
                </div>
                <Button onClick={() => setShowAddTrade(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Trade
                </Button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Trades</p>
                    <h3 className="text-2xl font-bold">{filteredTrades.length}</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Buy Volume</p>
                    <h3 className="text-2xl font-bold text-primary">
                        ${summaryStats.totalBuyVolume.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        })}
                    </h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Sell Volume</p>
                    <h3 className="text-2xl font-bold text-destructive">
                        ${summaryStats.totalSellVolume.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        })}
                    </h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">This Month</p>
                    <h3 className="text-2xl font-bold">{filteredTrades.length} trades</h3>
                </Card>
            </div>

            {/* Trade Log Table */}
            <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold">All Transactions</h3>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
                            <Filter className="h-4 w-4 mr-2" />
                            Filter
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                exportToCsv('trade-log.csv', filteredTrades.map((t) => ({
                                    Date: t.date,
                                    Ticker: t.symbol,
                                    Name: t.name,
                                    Side: t.type,
                                    Quantity: t.quantity,
                                    Price: t.price,
                                    'Total Value': t.totalValue,
                                    Account: t.account,
                                    Status: t.status,
                                    Strategy: t.strategy,
                                    Tags: t.tags.join('; '),
                                })))
                            }
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Export
                        </Button>
                    </div>
                </div>

                {/* Filters */}
                {showFilters && (
                    <div className="mb-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                                <SelectTrigger className="w-40 min-w-[140px]">
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
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={clearFilters}
                                >
                                    <X className="h-4 w-4 mr-2" />
                                    Clear Filters
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Table */}
                <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-accent/50">
                            <tr>
                                <th className="text-left py-4 px-4 text-xs text-muted-foreground font-medium">DATE</th>
                                <th className="text-left py-4 px-4 text-xs text-muted-foreground font-medium">SYMBOL</th>
                                <th className="text-center py-4 px-4 text-xs text-muted-foreground font-medium">TYPE</th>
                                <th className="text-right py-4 px-4 text-xs text-muted-foreground font-medium">QUANTITY</th>
                                <th className="text-right py-4 px-4 text-xs text-muted-foreground font-medium">PRICE</th>
                                <th className="text-right py-4 px-4 text-xs text-muted-foreground font-medium">TOTAL VALUE</th>
                                <th className="text-left py-4 px-4 text-xs text-muted-foreground font-medium">ACCOUNT</th>
                                <th className="text-center py-4 px-4 text-xs text-muted-foreground font-medium">STATUS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTrades.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="py-16 text-center text-muted-foreground">
                                        No trades match the selected filters.
                                    </td>
                                </tr>
                            )}
                            {filteredTrades.map((trade) => (
                                <tr
                                    key={trade.id}
                                    className="border-t border-border hover:bg-accent/30 transition-colors"
                                >
                                    <td className="py-4 px-4 text-sm">
                                        {new Date(trade.date).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                        })}
                                    </td>
                                    <td className="py-4 px-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                                                <span className="text-xs font-bold">{trade.symbol.slice(0, 2)}</span>
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm">{trade.symbol}</p>
                                                <p className="text-xs text-muted-foreground">{trade.name}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-4 px-4 text-center">
                                        <Badge
                                            variant={trade.type === 'BUY' ? 'default' : 'destructive'}
                                            className="gap-1"
                                        >
                                            {trade.type === 'BUY' ? (
                                                <ArrowDownRight className="h-3 w-3" />
                                            ) : (
                                                <ArrowUpRight className="h-3 w-3" />
                                            )}
                                            {trade.type}
                                        </Badge>
                                    </td>
                                    <td className="py-4 px-4 text-right font-medium">{trade.quantity}</td>
                                    <td className="py-4 px-4 text-right">${trade.price.toFixed(2)}</td>
                                    <td className="py-4 px-4 text-right font-medium">
                                        ${trade.totalValue.toLocaleString('en-US', {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                        })}
                                    </td>
                                    <td className="py-4 px-4 text-sm text-muted-foreground">{trade.account}</td>
                                    <td className="py-4 px-4 text-center">
                                        <Badge
                                            variant={
                                                trade.status === 'completed'
                                                    ? 'outline'
                                                    : trade.status === 'pending'
                                                        ? 'secondary'
                                                        : 'destructive'
                                            }
                                        >
                                            {trade.status}
                                        </Badge>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <AddTradeModal
                open={showAddTrade}
                onOpenChange={setShowAddTrade}
                onSubmit={(trade) => {
                    setTrades((prev) => [{ id: crypto.randomUUID(), ...trade }, ...prev]);
                }}
            />
        </div>
    );
}

export default function TradeLogPage() {
    return (
        <Suspense fallback={<div>Loading trade logs...</div>}>
            <TradeLogContent />
        </Suspense>
    );
}
