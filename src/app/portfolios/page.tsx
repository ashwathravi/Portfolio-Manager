'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Plus, ArrowUpDown, MoreHorizontal, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

type SortField = 'name' | 'value' | 'dayChange' | 'totalReturn' | 'cashBalance' | 'lastUpdated';
type SortOrder = 'asc' | 'desc';

export default function PortfoliosPage() {
    const router = useRouter();
    const [viewBy, setViewBy] = useState<'account' | 'tag' | 'strategy'>('account');
    const [sortField, setSortField] = useState<SortField>('value');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
    const [searchQuery, setSearchQuery] = useState('');
    const [showNewPortfolioModal, setShowNewPortfolioModal] = useState(false);
    const [newPortfolioName, setNewPortfolioName] = useState('');
    const [newPortfolioDesc, setNewPortfolioDesc] = useState('');

    const handleCreatePortfolio = () => {
        if (!newPortfolioName.trim()) return;
        const newEntry = {
            id: String(Date.now()),
            name: newPortfolioName.trim(),
            value: 0,
            dayChange: 0,
            dayChangeValue: 0,
            totalReturn: 0,
            totalReturnValue: 0,
            cashBalance: 0,
            lastUpdated: new Date().toLocaleDateString('en-US'),
        };
        setAccountsData((prev) => [...prev, newEntry]);
        setNewPortfolioName('');
        setNewPortfolioDesc('');
        setShowNewPortfolioModal(false);
    };

    // Mock data for different views
    const [accountsData, setAccountsData] = useState([
        {
            id: '1',
            name: 'Main Investment Account',
            value: 625000.50,
            dayChange: 0.42,
            dayChangeValue: 2625.00,
            totalReturn: 27.38,
            totalReturnValue: 134200.00,
            cashBalance: 45230.12,
            lastUpdated: '2/7/2026',
        },
        {
            id: '2',
            name: 'Retirement IRA',
            value: 450200.89,
            dayChange: 0.03,
            dayChangeValue: 135.06,
            totalReturn: 18.47,
            totalReturnValue: 70250.00,
            cashBalance: 2500.00,
            lastUpdated: '2/7/2026',
        },
        {
            id: '3',
            name: 'Speculative Trading',
            value: 25400.00,
            dayChange: 3.63,
            dayChangeValue: 892.00,
            totalReturn: 15.33,
            totalReturnValue: 3375.00,
            cashBalance: 15000.00,
            lastUpdated: '2/7/2026',
        },
    ]);

    const strategiesData = [
        {
            id: '1',
            name: 'Growth Tech',
            value: 485000.00,
            dayChange: 0.85,
            dayChangeValue: 4083.75,
            totalReturn: 32.50,
            totalReturnValue: 118943.75,
            cashBalance: 12500.00,
            lastUpdated: '2/7/2026',
        },
        {
            id: '2',
            name: 'Value Investing',
            value: 345792.85,
            dayChange: -0.12,
            dayChangeValue: -414.95,
            totalReturn: 18.25,
            totalReturnValue: 53406.88,
            cashBalance: 8230.12,
            lastUpdated: '2/7/2026',
        },
        {
            id: '3',
            name: 'Momentum Trading',
            value: 300000.00,
            dayChange: 1.25,
            dayChangeValue: 3712.50,
            totalReturn: 22.80,
            totalReturnValue: 55890.00,
            cashBalance: 42000.00,
            lastUpdated: '2/7/2026',
        },
    ];

    const tagsData = [
        {
            id: '1',
            name: 'High Conviction',
            value: 520000.00,
            dayChange: 0.95,
            dayChangeValue: 4900.00,
            totalReturn: 35.20,
            totalReturnValue: 135280.00,
            cashBalance: 5000.00,
            lastUpdated: '2/7/2026',
        },
        {
            id: '2',
            name: 'VCP Setup',
            value: 285792.85,
            dayChange: 0.44,
            dayChangeValue: 1257.49,
            totalReturn: 24.15,
            totalReturnValue: 55560.00,
            cashBalance: 12230.12,
            lastUpdated: '2/7/2026',
        },
        {
            id: '3',
            name: 'Earnings Play',
            value: 180000.00,
            dayChange: -1.25,
            dayChangeValue: -2272.50,
            totalReturn: 12.50,
            totalReturnValue: 20000.00,
            cashBalance: 25000.00,
            lastUpdated: '2/7/2026',
        },
        {
            id: '4',
            name: 'FOMO',
            value: 145000.00,
            dayChange: 2.15,
            dayChangeValue: 3052.50,
            totalReturn: -8.30,
            totalReturnValue: -13100.00,
            cashBalance: 20000.00,
            lastUpdated: '2/7/2026',
        },
    ];

    const currentData = viewBy === 'account' ? accountsData : viewBy === 'strategy' ? strategiesData : tagsData;

    // Filter data based on search query
    const filteredData = currentData.filter((item) =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Sort data
    const sortedData = [...filteredData].sort((a, b) => {
        const aValue = a[sortField];
        const bValue = b[sortField];

        if (sortField === 'name') {
            return sortOrder === 'asc'
                ? (aValue as string).localeCompare(bValue as string)
                : (bValue as string).localeCompare(aValue as string);
        }

        return sortOrder === 'asc'
            ? (aValue as number) - (bValue as number)
            : (bValue as number) - (aValue as number);
    });

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
    };

    const handleRowClick = (item: { id: string }) => {
        if (viewBy === 'account') {
            router.push(`/portfolios/holdings?account=${item.id}`);
        } else if (viewBy === 'strategy') {
            router.push(`/portfolios/holdings?strategy=${item.id}`);
        } else {
            router.push(`/portfolios/holdings?tag=${item.id}`);
        }
    };

    const { totalValue, totalCash } = sortedData.reduce(
        (acc, item) => {
            acc.totalValue += item.value;
            acc.totalCash += item.cashBalance;
            return acc;
        },
        { totalValue: 0, totalCash: 0 }
    );

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Portfolios</h1>
                    <p className="text-muted-foreground">
                        Manage your investment portfolios and track performance.
                    </p>
                </div>
                <Button className="bg-primary hover:bg-primary/90" onClick={() => setShowNewPortfolioModal(true)} aria-haspopup="dialog">
                    <Plus className="h-4 w-4 mr-2" />
                    New Portfolio
                </Button>
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground mr-2">View by:</span>
                <Button
                    variant={viewBy === 'account' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewBy('account')}
                >
                    Account
                </Button>
                <Button
                    variant={viewBy === 'strategy' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewBy('strategy')}
                >
                    Strategy
                </Button>
                <Button
                    variant={viewBy === 'tag' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewBy('tag')}
                >
                    Tag
                </Button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Value</p>
                    <h3 className="text-2xl font-bold">
                        ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Cash</p>
                    <h3 className="text-2xl font-bold">
                        ${totalCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </h3>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Number of {viewBy === 'account' ? 'Accounts' : viewBy === 'strategy' ? 'Strategies' : 'Tags'}</p>
                    <h3 className="text-2xl font-bold">{sortedData.length}</h3>
                </Card>
            </div>

            {/* Table */}
            <Card className="p-6">
                {/* Search */}
                <div className="mb-4 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Filter..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 max-w-sm"
                    />
                </div>

                {/* Table */}
                <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-accent/50">
                            <tr>
                                <th className="text-left py-4 px-4">
                                    <button
                                        onClick={() => handleSort('name')}
                                        aria-sort={sortField === 'name' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                                        className="flex items-center gap-2 text-xs text-muted-foreground font-medium hover:text-foreground transition-colors"
                                    >
                                        NAME
                                        <ArrowUpDown className="h-3 w-3" />
                                    </button>
                                </th>
                                <th className="text-right py-4 px-4">
                                    <button
                                        onClick={() => handleSort('value')}
                                        aria-sort={sortField === 'value' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                                        className="flex items-center gap-2 ml-auto text-xs text-muted-foreground font-medium hover:text-foreground transition-colors"
                                    >
                                        VALUE
                                        <ArrowUpDown className="h-3 w-3" />
                                    </button>
                                </th>
                                <th className="hidden sm:table-cell text-right py-4 px-4">
                                    <button
                                        onClick={() => handleSort('dayChange')}
                                        aria-sort={sortField === 'dayChange' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                                        className="flex items-center gap-2 ml-auto text-xs text-muted-foreground font-medium hover:text-foreground transition-colors"
                                    >
                                        DAY CHANGE
                                        <ArrowUpDown className="h-3 w-3" />
                                    </button>
                                </th>
                                <th className="hidden sm:table-cell text-right py-4 px-4">
                                    <button
                                        onClick={() => handleSort('totalReturn')}
                                        aria-sort={sortField === 'totalReturn' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                                        className="flex items-center gap-2 ml-auto text-xs text-muted-foreground font-medium hover:text-foreground transition-colors"
                                    >
                                        TOTAL RETURN
                                        <ArrowUpDown className="h-3 w-3" />
                                    </button>
                                </th>
                                <th className="hidden md:table-cell text-right py-4 px-4">
                                    <button
                                        onClick={() => handleSort('cashBalance')}
                                        aria-sort={sortField === 'cashBalance' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                                        className="flex items-center gap-2 ml-auto text-xs text-muted-foreground font-medium hover:text-foreground transition-colors"
                                    >
                                        CASH BALANCE
                                        <ArrowUpDown className="h-3 w-3" />
                                    </button>
                                </th>
                                <th className="hidden md:table-cell text-left py-4 px-4 text-xs text-muted-foreground font-medium">
                                    LAST UPDATED
                                </th>
                                <th className="py-4 px-4"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="py-16 text-center text-muted-foreground">
                                        No portfolios match your search.
                                    </td>
                                </tr>
                            )}
                            {sortedData.map((item) => (
                                <tr
                                    key={item.id}
                                    className="border-t border-border hover:bg-accent/30 transition-colors cursor-pointer"
                                    onClick={() => handleRowClick(item)}
                                >
                                    <td className="py-4 px-4">
                                        <p className="font-medium">{item.name}</p>
                                    </td>
                                    <td className="py-4 px-4 text-right font-medium">
                                        ${item.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="hidden sm:table-cell py-4 px-4 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            {item.dayChange >= 0 ? (
                                                <TrendingUp className="h-3 w-3 text-primary" />
                                            ) : (
                                                <TrendingDown className="h-3 w-3 text-destructive" />
                                            )}
                                            <span className={item.dayChange >= 0 ? 'text-primary' : 'text-destructive'}>
                                                {item.dayChange >= 0 ? '+' : ''}{item.dayChange.toFixed(2)}%
                                            </span>
                                        </div>
                                    </td>
                                    <td className="hidden sm:table-cell py-4 px-4 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            {item.totalReturn >= 0 ? (
                                                <TrendingUp className="h-3 w-3 text-primary" />
                                            ) : (
                                                <TrendingDown className="h-3 w-3 text-destructive" />
                                            )}
                                            <span className={item.totalReturn >= 0 ? 'text-primary' : 'text-destructive'}>
                                                {item.totalReturn >= 0 ? '+' : ''}{item.totalReturn.toFixed(2)}%
                                            </span>
                                        </div>
                                    </td>
                                    <td className="hidden md:table-cell py-4 px-4 text-right">
                                        ${item.cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="hidden md:table-cell py-4 px-4 text-sm text-muted-foreground">
                                        {item.lastUpdated}
                                    </td>
                                    <td className="py-4 px-4">
                                        <button
                                            className="p-1 hover:bg-accent rounded transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                // Handle menu open
                                            }}
                                        >
                                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                        0 of {sortedData.length} row(s) selected.
                    </p>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" disabled>
                            Previous
                        </Button>
                        <Button variant="outline" size="sm" disabled>
                            Next
                        </Button>
                    </div>
                </div>
            </Card>
            {/* New Portfolio Modal */}
            <Dialog open={showNewPortfolioModal} onOpenChange={setShowNewPortfolioModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New Portfolio</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1">
                            <Label htmlFor="portfolio-name">Name</Label>
                            <Input
                                id="portfolio-name"
                                placeholder="e.g. Retirement IRA"
                                value={newPortfolioName}
                                onChange={(e) => setNewPortfolioName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleCreatePortfolio()}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="portfolio-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input
                                id="portfolio-desc"
                                placeholder="Brief description..."
                                value={newPortfolioDesc}
                                onChange={(e) => setNewPortfolioDesc(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowNewPortfolioModal(false)}>Cancel</Button>
                        <Button onClick={handleCreatePortfolio} disabled={!newPortfolioName.trim()}>Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
