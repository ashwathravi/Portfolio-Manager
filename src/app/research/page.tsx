'use client';

import { Suspense, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Plus,
    TrendingUp,
    BookOpen,
    Archive,
    Target,
    Clock,
    Pencil,
    Trash2,
    ArchiveRestore,
    Link2,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { NewThesisModal } from '@/components/research/NewThesisModal';
import { NewJournalEntryModal } from '@/components/research/NewJournalEntryModal';
import { WatchlistSection, type WatchlistItem } from '@/components/research/WatchlistSection';
import { useThesisStore } from '@/lib/research/useThesisStore';
import { useJournalStore } from '@/lib/research/useJournalStore';
import type { Thesis } from '@/lib/research/thesis';
import type { JournalEntry } from '@/lib/research/journal';


const mockWatchlist: WatchlistItem[] = [
    {
        id: '1',
        ticker: 'COIN',
        companyName: 'Coinbase Global, Inc.',
        reason: 'Waiting for BTC ETF approval catalyst',
        dateAdded: '1/15/2024',
        currentPrice: 165.5,
        targetEntry: 145.0,
        notes: 'Enter on pullback to $145 support level',
    },
    {
        id: '2',
        ticker: 'PLTR',
        companyName: 'Palantir Technologies Inc.',
        reason: 'AI Platform traction in commercial sector',
        dateAdded: '1/22/2024',
        currentPrice: 18.75,
        targetEntry: 16.5,
        notes: 'Wait for next earnings to confirm commercial growth',
    },
    {
        id: '3',
        ticker: 'SHOP',
        companyName: 'Shopify Inc.',
        reason: 'E-commerce recovery + margin expansion',
        dateAdded: '2/3/2024',
        currentPrice: 72.3,
        targetEntry: 65.0,
        notes: 'Target entry on market-wide pullback',
    },
];


function getConvictionColor(conviction: string) {
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
}

function formatDate(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleDateString('en-US');
}

function ResearchContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const currentTab = searchParams.get('tab') || 'theses';
    const { active, archived, theses, create, update, archive, restore, remove } = useThesisStore();
    const {
        entries: journalEntries,
        create: createJournal,
        update: updateJournal,
        remove: removeJournal,
    } = useJournalStore();
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Thesis | null>(null);
    const [journalModalOpen, setJournalModalOpen] = useState(false);
    const [editingJournal, setEditingJournal] = useState<JournalEntry | null>(null);

    const handleTabChange = (value: string) => {
        const params = new URLSearchParams(searchParams);
        params.set('tab', value);
        router.push(`/research?${params.toString()}`);
    };

    const openCreate = () => {
        setEditing(null);
        setModalOpen(true);
    };

    const openEdit = (thesis: Thesis) => {
        setEditing(thesis);
        setModalOpen(true);
    };

    const handleDelete = (thesis: Thesis) => {
        if (typeof window !== 'undefined' && !window.confirm(`Delete thesis for ${thesis.ticker}? This cannot be undone.`)) {
            return;
        }
        remove(thesis.id);
        toast.success(`Thesis for ${thesis.ticker} deleted.`);
    };

    const handleArchive = (thesis: Thesis) => {
        archive(thesis.id);
        toast(`Thesis for ${thesis.ticker} archived.`);
    };

    const handleRestore = (thesis: Thesis) => {
        restore(thesis.id);
        toast(`Thesis for ${thesis.ticker} restored.`);
        handleTabChange('theses');
    };

    const openCreateJournal = () => {
        setEditingJournal(null);
        setJournalModalOpen(true);
    };

    const openEditJournal = (entry: JournalEntry) => {
        setEditingJournal(entry);
        setJournalModalOpen(true);
    };

    const handleDeleteJournal = (entry: JournalEntry) => {
        if (typeof window !== 'undefined' && !window.confirm(`Delete journal entry for ${entry.ticker}? This cannot be undone.`)) {
            return;
        }
        removeJournal(entry.id);
        toast.success(`Journal entry for ${entry.ticker} deleted.`);
    };

    const thesesById = new Map(theses.map((t) => [t.id, t] as const));

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
                    <Button onClick={openCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Thesis
                    </Button>
                )}
                {currentTab === 'journal' && (
                    <Button onClick={openCreateJournal}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Entry
                    </Button>
                )}
            </div>

            <Tabs value={currentTab} onValueChange={handleTabChange}>
                <TabsList>
                    <TabsTrigger value="theses">Active Theses</TabsTrigger>
                    <TabsTrigger value="watchlist">Watchlists</TabsTrigger>
                    <TabsTrigger value="journal">Decision Journal</TabsTrigger>
                    <TabsTrigger value="archive">Archive</TabsTrigger>
                </TabsList>

                {/* Active Theses */}
                <TabsContent value="theses" className="space-y-4">
                    {active.length === 0 ? (
                        <Card className="p-10 text-center space-y-2">
                            <p className="text-muted-foreground">No active theses yet.</p>
                            <Button variant="outline" onClick={openCreate}>
                                <Plus className="mr-2 h-4 w-4" /> Create your first thesis
                            </Button>
                        </Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                            {active.map((thesis) => (
                                <Card key={thesis.id} className="p-6 transition-all hover:shadow-md">
                                    <div className="space-y-4">
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
                                                        {thesis.type === 'bull' ? 'Bull' : 'Bear'}
                                                    </Badge>
                                                </div>
                                                <p className="text-sm text-muted-foreground">
                                                    {thesis.companyName}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label="Edit thesis"
                                                    onClick={() => openEdit(thesis)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label="Archive thesis"
                                                    onClick={() => handleArchive(thesis)}
                                                >
                                                    <Archive className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label="Delete thesis"
                                                    onClick={() => handleDelete(thesis)}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="font-bold mb-2">{thesis.title}</h4>
                                            <p className="text-sm text-muted-foreground leading-relaxed">
                                                {thesis.description}
                                            </p>
                                        </div>

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

                                        <div className="flex items-center justify-between pt-2 border-t border-border">
                                            <span className="text-xs text-muted-foreground">
                                                Updated: {formatDate(thesis.dateUpdated)}
                                            </span>
                                            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => router.push(`/research/thesis/${thesis.ticker}`)}>
                                                View Analysis
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* Watchlists */}
                <TabsContent value="watchlist" className="space-y-4">
                    <WatchlistSection items={mockWatchlist} />
                </TabsContent>

                {/* Decision Journal */}
                <TabsContent value="journal" className="space-y-4">
                    {journalEntries.length === 0 ? (
                        <Card className="p-10 text-center space-y-2">
                            <p className="text-muted-foreground">No journal entries yet.</p>
                            <Button variant="outline" onClick={openCreateJournal}>
                                <Plus className="mr-2 h-4 w-4" /> Log your first decision
                            </Button>
                        </Card>
                    ) : (
                        <div className="space-y-4">
                            {journalEntries.map((entry) => {
                                const linkedThesis = entry.thesisId ? thesesById.get(entry.thesisId) : undefined;
                                return (
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
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
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
                                                            {entry.outcome !== 'pending' && (
                                                                <Badge
                                                                    variant={
                                                                        entry.outcome === 'win' ? 'default' : 'destructive'
                                                                    }
                                                                >
                                                                    {entry.outcome}
                                                                </Badge>
                                                            )}
                                                            {linkedThesis && (
                                                                <button
                                                                    onClick={() =>
                                                                        router.push(`/research/thesis/${linkedThesis.ticker}`)
                                                                    }
                                                                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10 transition-colors"
                                                                    aria-label={`View linked thesis ${linkedThesis.title}`}
                                                                >
                                                                    <Link2 className="h-3 w-3" />
                                                                    {linkedThesis.title}
                                                                </button>
                                                            )}
                                                        </div>
                                                        <p className="mt-1 font-medium">{entry.decision}</p>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label="Edit journal entry"
                                                            onClick={() => openEditJournal(entry)}
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label="Delete journal entry"
                                                            onClick={() => handleDeleteJournal(entry)}
                                                        >
                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                <p className="text-sm text-muted-foreground">
                                                    {entry.rationale}
                                                </p>
                                            </div>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </TabsContent>

                {/* Archive */}
                <TabsContent value="archive" className="space-y-4">
                    {archived.length === 0 ? (
                        <Card className="p-10 text-center">
                            <p className="text-muted-foreground">No archived theses.</p>
                        </Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                            {archived.map((thesis) => (
                                <Card key={thesis.id} className="p-6 transition-all hover:shadow-md opacity-75">
                                    <div className="space-y-4">
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
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label="Restore thesis"
                                                    onClick={() => handleRestore(thesis)}
                                                >
                                                    <ArchiveRestore className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label="Delete thesis"
                                                    onClick={() => handleDelete(thesis)}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div>
                                            <h4 className="font-bold mb-2">{thesis.title}</h4>
                                            <p className="text-sm text-muted-foreground leading-relaxed">
                                                {thesis.description}
                                            </p>
                                        </div>

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

                                        <div className="flex items-center justify-between pt-2 border-t border-border">
                                            <span className="text-xs text-muted-foreground">
                                                Archived: {formatDate(thesis.dateUpdated)}
                                            </span>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            <NewThesisModal
                open={modalOpen}
                onOpenChange={(open) => {
                    setModalOpen(open);
                    if (!open) setEditing(null);
                }}
                editing={editing}
                onSubmit={(draft) => {
                    if (editing) {
                        update(editing.id, draft);
                    } else {
                        create(draft);
                    }
                }}
            />

            <NewJournalEntryModal
                open={journalModalOpen}
                onOpenChange={(open) => {
                    setJournalModalOpen(open);
                    if (!open) setEditingJournal(null);
                }}
                editing={editingJournal}
                theses={theses}
                onSubmit={(draft) => {
                    if (editingJournal) {
                        updateJournal(editingJournal.id, draft);
                    } else {
                        createJournal(draft);
                    }
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
