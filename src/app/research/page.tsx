'use client';

import { Suspense } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Plus,
    TrendingUp,
    BookOpen,
    Eye,
    Archive,
    Target,
    Clock,
} from 'lucide-react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { NewThesisModal } from '@/components/research/NewThesisModal';

interface Thesis {
    id: string;
    ticker: string;
    companyName: string;
    title: string;
    description: string;
    type: 'bull' | 'bear';
    status: 'active' | 'monitoring' | 'archived';
    conviction: 'HIGH' | 'MEDIUM' | 'LOW';
    targetPrice: number;
    timeHorizon: string;
    dateUpdated: string;
    tags: string[];
}

interface WatchlistItem {
    id: string;
    ticker: string;
    companyName: string;
    reason: string;
    dateAdded: string;
    currentPrice: number;
    targetEntry: number;
    notes: string;
}

interface JournalEntry {
    id: string;
    date: string;
    type: 'entry' | 'exit' | 'hold';
    ticker: string;
    decision: string;
    rationale: string;
    outcome?: 'win' | 'loss' | 'pending';
}

const mockTheses: Thesis[] = [
    {
        id: '1',
        ticker: 'NVDA',
        companyName: 'NVIDIA Corporation',
        title: 'AI Infrastructure Dominance',
        description: 'NVIDIA is uniquely positioned to capture majority of Data Center AI spend due to CUDA moat and H100 rollout. Supply constraints will support high ASPs through 2024.',
        type: 'bull',
        status: 'active',
        conviction: 'HIGH',
        targetPrice: 950,
        timeHorizon: '18-24 months',
        dateUpdated: '2/1/2024',
        tags: ['AI', 'Semiconductors', 'Data Center'],
    },
    {
        id: '2',
        ticker: 'TSLA',
        companyName: 'Tesla, Inc.',
        title: 'Margin Compression Concerns',
        description: 'Increased competition in EV space and aggressive price cuts will compress auto gross margins below 15%. FSD revenue recognition is delayed.',
        type: 'bear',
        status: 'active',
        conviction: 'MEDIUM',
        targetPrice: 180,
        timeHorizon: '12 months',
        dateUpdated: '2/5/2024',
        tags: ['EV', 'Automotive', 'Competition'],
    },
    {
        id: '3',
        ticker: 'MSFT',
        companyName: 'Microsoft Corporation',
        title: 'Azure AI Growth Acceleration',
        description: 'Azure AI services and GitHub Copilot driving incremental $10B+ revenue. Enterprise AI adoption cycle just beginning with strong competitive positioning.',
        type: 'bull',
        status: 'active',
        conviction: 'HIGH',
        targetPrice: 485,
        timeHorizon: '24 months',
        dateUpdated: '1/28/2024',
        tags: ['Cloud', 'AI', 'Enterprise'],
    },
];

const mockWatchlist: WatchlistItem[] = [
    {
        id: '1',
        ticker: 'COIN',
        companyName: 'Coinbase Global, Inc.',
        reason: 'Waiting for BTC ETF approval catalyst',
        dateAdded: '1/15/2024',
        currentPrice: 165.50,
        targetEntry: 145.00,
        notes: 'Enter on pullback to $145 support level',
    },
    {
        id: '2',
        ticker: 'PLTR',
        companyName: 'Palantir Technologies Inc.',
        reason: 'AI Platform traction in commercial sector',
        dateAdded: '1/22/2024',
        currentPrice: 18.75,
        targetEntry: 16.50,
        notes: 'Wait for next earnings to confirm commercial growth',
    },
    {
        id: '3',
        ticker: 'SHOP',
        companyName: 'Shopify Inc.',
        reason: 'E-commerce recovery + margin expansion',
        dateAdded: '2/3/2024',
        currentPrice: 72.30,
        targetEntry: 65.00,
        notes: 'Target entry on market-wide pullback',
    },
];

const mockJournalEntries: JournalEntry[] = [
    {
        id: '1',
        date: '2026-02-05',
        type: 'entry',
        ticker: 'AAPL',
        decision: 'Increased position by 50 shares',
        rationale: 'Strong iPhone sales data, expansion in services revenue. Vision Pro launch creating new product category with minimal competition.',
        outcome: 'pending',
    },
    {
        id: '2',
        date: '2026-02-03',
        type: 'exit',
        ticker: 'TSLA',
        decision: 'Reduced position by 25 shares',
        rationale: 'Taking profits after 20% gain, valuation concerns. Increased competition from legacy automakers and margin pressure from price cuts.',
        outcome: 'win',
    },
    {
        id: '3',
        date: '2026-01-28',
        type: 'entry',
        ticker: 'NVDA',
        decision: 'Opened position with 20 shares',
        rationale: 'AI data center demand exceeding expectations. CUDA moat remains strong. H100 supply constraints supporting ASPs.',
        outcome: 'pending',
    },
    {
        id: '4',
        date: '2026-01-20',
        type: 'hold',
        ticker: 'MSFT',
        decision: 'Maintaining position through earnings',
        rationale: 'Azure AI services showing strong adoption. Copilot revenue ramping. Cloud margin expansion narrative intact.',
        outcome: 'pending',
    },
];

const archivedTheses: Thesis[] = [
    {
        id: '4',
        ticker: 'META',
        companyName: 'Meta Platforms, Inc.',
        title: 'Metaverse Pivot Risk',
        description: 'Heavy CapEx on metaverse initiatives with unclear ROI. Reality Labs losses exceeding $10B annually.',
        type: 'bear',
        status: 'archived',
        conviction: 'MEDIUM',
        targetPrice: 180,
        timeHorizon: '12 months',
        dateUpdated: '12/15/2023',
        tags: ['Social Media', 'Metaverse', 'CapEx'],
    },
];

function ResearchContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const currentTab = searchParams.get('tab') || 'theses';
    const [theses, setTheses] = useState(mockTheses);
    const [showNewThesis, setShowNewThesis] = useState(false);

    const handleTabChange = (value: string) => {
        const params = new URLSearchParams(searchParams);
        params.set('tab', value);
        router.push(`/research?${params.toString()}`);
    };

    const getConvictionColor = (conviction: string) => {
        switch (conviction) {
            case 'HIGH':
                return 'bg-primary text-primary-foreground';
            case 'MEDIUM':
                return 'bg-yellow-500 text-yellow-950';
            case 'LOW':
                return 'bg-muted text-muted-foreground';
            default:
                return 'bg-muted';
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Research</h1>
                    <p className="text-muted-foreground">
                        Develop and track your investment theses and decision log.
                    </p>
                </div>
                {currentTab === 'theses' && (
                    <Button onClick={() => setShowNewThesis(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Thesis
                    </Button>
                )}
            </div>

            {/* Tabs */}
            <Tabs value={currentTab} onValueChange={handleTabChange}>
                <TabsList>
                    <TabsTrigger value="theses">Active Theses</TabsTrigger>
                    <TabsTrigger value="watchlist">Watchlists</TabsTrigger>
                    <TabsTrigger value="journal">Decision Journal</TabsTrigger>
                    <TabsTrigger value="archive">Archive</TabsTrigger>
                </TabsList>

                {/* Active Theses */}
                <TabsContent value="theses" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        {theses.map((thesis) => (
                            <Card key={thesis.id} className="p-6 transition-all hover:shadow-md">
                                <div className="space-y-4">
                                    {/* Header */}
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3
                                                    className="text-xl font-bold cursor-pointer hover:text-primary transition-colors"
                                                    onClick={() => router.push(`/research/thesis/${thesis.ticker}`)}
                                                >
                                                    {thesis.ticker}
                                                </h3>
                                                <Badge className={getConvictionColor(thesis.conviction)}>
                                                    {thesis.status === 'active' ? 'Active' : 'Monitoring'}
                                                </Badge>
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                                {thesis.companyName}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Thesis Title */}
                                    <div>
                                        <h4 className="font-bold mb-2">{thesis.title}</h4>
                                        <p className="text-sm text-muted-foreground leading-relaxed">
                                            {thesis.description}
                                        </p>
                                    </div>

                                    {/* Metrics */}
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium ${getConvictionColor(thesis.conviction)}`}>
                                                <TrendingUp className="h-3 w-3" />
                                                {thesis.conviction} CONVICTION
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                            <Clock className="h-3 w-3" />
                                            {thesis.timeHorizon}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1 text-sm">
                                        <Target className="h-4 w-4 text-primary" />
                                        <span className="font-medium">Target: ${thesis.targetPrice}</span>
                                    </div>

                                    {/* Footer */}
                                    <div className="flex items-center justify-between pt-2 border-t border-border">
                                        <span className="text-xs text-muted-foreground">
                                            Updated: {thesis.dateUpdated}
                                        </span>
                                        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => router.push(`/research/thesis/${thesis.ticker}`)}>
                                            View Analysis
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                {/* Watchlists */}
                <TabsContent value="watchlist" className="space-y-4">
                    <div className="space-y-3">
                        {mockWatchlist.map((item) => (
                            <Card key={item.id} className="p-6 transition-all hover:shadow-md">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 space-y-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                                <span className="text-sm font-bold">{item.ticker.slice(0, 2)}</span>
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-lg">{item.ticker}</h3>
                                                <p className="text-sm text-muted-foreground">{item.companyName}</p>
                                            </div>
                                        </div>

                                        <div>
                                            <p className="font-medium mb-1">{item.reason}</p>
                                            <p className="text-sm text-muted-foreground">{item.notes}</p>
                                        </div>

                                        <div className="grid grid-cols-3 gap-4 pt-2">
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1">Current Price</p>
                                                <p className="font-bold">${item.currentPrice.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1">Target Entry</p>
                                                <p className="font-bold text-primary">${item.targetEntry.toFixed(2)}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1">Distance</p>
                                                <p className={`font-bold ${item.currentPrice > item.targetEntry ? 'text-destructive' : 'text-primary'}`}>
                                                    {(((item.targetEntry - item.currentPrice) / item.currentPrice) * 100).toFixed(1)}%
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end gap-2">
                                        <Badge variant="secondary" className="whitespace-nowrap">
                                            Added {item.dateAdded}
                                        </Badge>
                                        <Button variant="outline" size="sm">
                                            <Eye className="h-4 w-4 mr-2" />
                                            View Details
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                {/* Decision Journal */}
                <TabsContent value="journal" className="space-y-4">
                    <div className="space-y-4">
                        {mockJournalEntries.map((entry) => (
                            <Card key={entry.id} className="p-6">
                                <div className="flex gap-4">
                                    <div className="flex flex-col items-center">
                                        <div className="rounded-lg bg-primary/10 p-3 text-primary">
                                            <BookOpen className="h-5 w-5" />
                                        </div>
                                        <div className="mt-2 text-center">
                                            <p className="text-xs text-muted-foreground">
                                                {new Date(entry.date).toLocaleDateString('en-US', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                })}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-semibold">{entry.ticker}</h3>
                                                    <Badge
                                                        variant={
                                                            entry.type === 'entry'
                                                                ? 'default'
                                                                : entry.type === 'exit'
                                                                    ? 'destructive'
                                                                    : 'secondary'
                                                        }
                                                    >
                                                        {entry.type}
                                                    </Badge>
                                                    {entry.outcome && entry.outcome !== 'pending' && (
                                                        <Badge
                                                            variant={
                                                                entry.outcome === 'win' ? 'default' : 'destructive'
                                                            }
                                                        >
                                                            {entry.outcome}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="mt-1 font-medium">{entry.decision}</p>
                                            </div>
                                        </div>

                                        <p className="text-sm text-muted-foreground">
                                            {entry.rationale}
                                        </p>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                {/* Archive */}
                <TabsContent value="archive" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        {archivedTheses.map((thesis) => (
                            <Card key={thesis.id} className="p-6 transition-all hover:shadow-md opacity-75">
                                <div className="space-y-4">
                                    {/* Header */}
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="text-xl font-bold">{thesis.ticker}</h3>
                                                <Badge variant="secondary" className="bg-muted">
                                                    <Archive className="h-3 w-3 mr-1" />
                                                    Archived
                                                </Badge>
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                                {thesis.companyName}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Thesis Title */}
                                    <div>
                                        <h4 className="font-bold mb-2">{thesis.title}</h4>
                                        <p className="text-sm text-muted-foreground leading-relaxed">
                                            {thesis.description}
                                        </p>
                                    </div>

                                    {/* Metrics */}
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium ${getConvictionColor(thesis.conviction)}`}>
                                                {thesis.conviction} CONVICTION
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                            <Clock className="h-3 w-3" />
                                            {thesis.timeHorizon}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1 text-sm">
                                        <Target className="h-4 w-4 text-muted-foreground" />
                                        <span className="font-medium text-muted-foreground">Target: ${thesis.targetPrice}</span>
                                    </div>

                                    {/* Footer */}
                                    <div className="flex items-center justify-between pt-2 border-t border-border">
                                        <span className="text-xs text-muted-foreground">
                                            Archived: {thesis.dateUpdated}
                                        </span>
                                        <Button variant="link" size="sm" className="h-auto p-0">
                                            Restore
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                </TabsContent>
            </Tabs>

            <NewThesisModal
                open={showNewThesis}
                onOpenChange={setShowNewThesis}
                onSubmit={(data) => {
                    setTheses((prev) => [
                        {
                            id: crypto.randomUUID(),
                            status: 'active' as const,
                            dateUpdated: new Date().toISOString().split('T')[0],
                            tags: [],
                            ...data,
                        },
                        ...prev,
                    ]);
                }}
            />
        </div>
    );
}

export default function ResearchPage() {
    return (
        <div className="p-6">
            <Suspense fallback={<div>Loading...</div>}>
                <ResearchContent />
            </Suspense>
        </div>
    );
}
