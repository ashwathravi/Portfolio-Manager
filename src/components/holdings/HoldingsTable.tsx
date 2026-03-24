
'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Filter, Download, Plus, X, ChevronRight } from 'lucide-react';
import { useState, useCallback, memo, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SparklineCell } from '@/components/data-display/SparklineCell';

export interface Holding {
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

const accounts = ['All Accounts', 'Fidelity Individual', 'Vanguard Roth IRA', 'Robinhood Trading', 'Main Portfolio', 'Growth Portfolio', 'Dividend Income'];
const strategies = ['All Strategies', 'Growth Tech', 'Value Investing', 'Momentum Trading'];
const tags = ['All Tags', 'High Conviction', 'VCP Setup', 'Earnings Play', 'FOMO'];

// Optimized: Memoized row component to prevent unnecessary re-renders when parent filters change but this item is still visible
const HoldingRow = memo(({ holding, onDoubleClick }: { holding: Holding; onDoubleClick: (symbol: string) => void }) => {
    return (
        <tr
            className="border-t border-border hover:bg-accent/30 transition-colors cursor-pointer"
            onDoubleClick={() => onDoubleClick(holding.symbol)}
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
                    <p className={`font-medium ${holding.totalReturn >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        {holding.totalReturn >= 0 ? '+' : ''}${holding.totalReturn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className={`text-xs ${holding.totalReturn >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        {holding.totalReturn >= 0 ? '+' : ''}{holding.returnPercentage.toFixed(2)}%
                    </p>
                </div>
            </td>
            <td className="py-4 px-4">
                <div className="flex items-center justify-center">
                    <SparklineCell
                        data={holding.trend}
                        width={80}
                        height={30}
                        color={holding.totalReturn >= 0 ? "primary" : "danger"}
                    />
                </div>
            </td>
            <td className="py-4 px-4">
                <Button size="sm" className="rounded-full w-10 h-10 p-0">
                    <Plus className="h-5 w-5" />
                </Button>
            </td>
        </tr>
    );
});
HoldingRow.displayName = 'HoldingRow';

export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
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
        return 'All Strategies';
    });

    const [selectedTag, setSelectedTag] = useState(() => {
        const param = searchParams.get('tag');
        return 'All Tags';
    });

    const [showFilters, setShowFilters] = useState(() => {
        return !!(searchParams.get('account') || searchParams.get('strategy') || searchParams.get('tag'));
    });

    // Optimized: Build a reverse index of holdings by tag to allow O(1) source selection and avoid includes() in the loop.
    // We deduplicate tags for each holding to prevent duplicate rows if the same tag is assigned twice.
    // Optimization: Avoid creating a new Set for every holding to reduce garbage collection pressure.
    const holdingsByTag = useMemo(() => {
        const map = new Map<string, Holding[]>();
        for (let i = 0; i < holdings.length; i++) {
            const holding = holdings[i];
            const tags = holding.tags;
            for (let j = 0; j < tags.length; j++) {
                const tag = tags[j];
                // Deduplicate: only handle first occurrence of tag in the tags array for this holding
                if (tags.indexOf(tag) !== j) continue;

                let list = map.get(tag);
                if (list === undefined) {
                    list = [];
                    map.set(tag, list);
                }
                list.push(holding);
            }
        }
        return map;
    }, [holdings]);

    // Optimized: Combine filter and reduce into a single pass loop to avoid multiple iterations (O(N) vs O(3N))
    const { filteredHoldings, totalNetValue, totalReturn } = useMemo(() => {
        const result = [];
        let netValue = 0;
        let ret = 0;

        // Optimized: If a tag is selected, only iterate over holdings that have that tag
        const source = selectedTag !== 'All Tags'
            ? (holdingsByTag.get(selectedTag) || [])
            : holdings;

        for (const holding of source) {
            // Optimized: Short-circuit checks to avoid unnecessary comparisons
            if (selectedAccount !== 'All Accounts' && holding.account !== selectedAccount) continue;
            if (selectedStrategy !== 'All Strategies' && holding.strategy !== selectedStrategy) continue;

            result.push(holding);
            netValue += holding.totalValue;
            ret += holding.totalReturn;
        }

        return {
            filteredHoldings: result,
            totalNetValue: netValue,
            totalReturn: ret
        };
    }, [holdings, selectedAccount, selectedStrategy, selectedTag, holdingsByTag]);

    const clearFilters = () => {
        setSelectedAccount('All Accounts');
        setSelectedStrategy('All Strategies');
        setSelectedTag('All Tags');
    };

    // Optimized: Calculate active filters without array allocation
    let activeFiltersCount = 0;
    if (selectedAccount !== 'All Accounts') activeFiltersCount++;
    if (selectedStrategy !== 'All Strategies') activeFiltersCount++;
    if (selectedTag !== 'All Tags') activeFiltersCount++;

    const handleHoldingDoubleClick = useCallback((symbol: string) => {
        router.push(`/portfolios/detail/${symbol}`);
    }, [router]);

    const hasActiveFilters = activeFiltersCount > 0;

    // Optimized: Calculate filter text directly to avoid function creation
    let filterText = '';
    if (selectedAccount !== 'All Accounts') filterText = selectedAccount;
    else if (selectedStrategy !== 'All Strategies') filterText = selectedStrategy;
    else if (selectedTag !== 'All Tags') filterText = selectedTag;


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
                    <span className="text-foreground font-medium">{filterText}</span>
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
                    <h3 className="text-2xl font-bold text-primary">${totalNetValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Net Realized P&L</p>
                    <h3 className="text-2xl font-bold text-primary">${totalReturn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Starting Account Balance</p>
                    <h3 className="text-2xl font-bold">$0.00</h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">No. of Positions</p>
                    <h3 className="text-2xl font-bold">{filteredHoldings.length}</h3>
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
                                <HoldingRow
                                    key={holding.id}
                                    holding={holding}
                                    onDoubleClick={handleHoldingDoubleClick}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
