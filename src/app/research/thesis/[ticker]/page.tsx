'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    ExternalLink,
    AlertCircle,
    CheckCircle2,
    Calendar,
    FileText,
    TrendingUp,
    ChevronRight,
} from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { useThesisStore } from '@/lib/research/useThesisStore';
import { NewThesisModal } from '@/components/research/NewThesisModal';
import { AddCatalystModal } from '@/components/research/AddCatalystModal';
import { AddEvidenceModal } from '@/components/research/AddEvidenceModal';
import type { EvidenceType } from '@/lib/research/thesis';

function formatDate(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleDateString('en-US');
}

function getConvictionColor(conviction: string) {
    switch (conviction) {
        case 'HIGH':
            return 'bg-primary/10 text-primary border-primary/20';
        case 'MEDIUM':
            return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
        case 'LOW':
            return 'bg-muted text-muted-foreground border-border';
        default:
            return 'bg-muted text-muted-foreground border-border';
    }
}

function getImpactColor(impact: string) {
    switch (impact) {
        case 'high':
            return 'bg-primary/10 text-primary';
        case 'medium':
            return 'bg-yellow-500/10 text-yellow-500';
        case 'low':
            return 'bg-muted text-muted-foreground';
        default:
            return 'bg-muted text-muted-foreground';
    }
}

function getTypeIcon(type: EvidenceType) {
    switch (type) {
        case 'earnings':
            return <TrendingUp className="h-4 w-4" />;
        case 'article':
        case 'report':
        case 'note':
        default:
            return <FileText className="h-4 w-4" />;
    }
}

export default function ThesisDetailPage() {
    const router = useRouter();
    const params = useParams();
    const ticker = ((params?.ticker as string) ?? '').toUpperCase();

    const { findByTicker, update, addCatalyst, addEvidence, hydrated } = useThesisStore();
    const thesis = findByTicker(ticker);

    const [editOpen, setEditOpen] = useState(false);
    const [catalystOpen, setCatalystOpen] = useState(false);
    const [evidenceOpen, setEvidenceOpen] = useState(false);

    // Avoid a flash of "not found" during the SSR -> hydration window.
    if (!hydrated) {
        return (
            <div className="flex h-full items-center justify-center p-12">
                <p className="text-muted-foreground">Loading thesis...</p>
            </div>
        );
    }

    if (!thesis) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-12">
                <p className="text-muted-foreground">Thesis not found for ticker: {ticker}</p>
                <Button variant="outline" onClick={() => router.push('/research')}>
                    Back to Research
                </Button>
            </div>
        );
    }

    const upside =
        typeof thesis.currentPrice === 'number' && thesis.currentPrice > 0
            ? (((thesis.targetPrice - thesis.currentPrice) / thesis.currentPrice) * 100).toFixed(1)
            : null;
    const isPositiveThesis = thesis.type === 'bull';

    return (
        <div className="space-y-6 p-6">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm">
                <button
                    onClick={() => router.push('/research')}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                >
                    Research
                </button>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <button
                    onClick={() => router.push('/research?tab=theses')}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                >
                    Active Theses
                </button>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <span className="text-foreground font-medium">{thesis.ticker}</span>
            </div>

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-3xl font-bold tracking-tight">{thesis.ticker}</h1>
                        <Badge className={getConvictionColor(thesis.conviction)}>
                            {thesis.conviction} CONVICTION
                        </Badge>
                        <Badge variant={isPositiveThesis ? 'default' : 'destructive'}>
                            {isPositiveThesis ? 'BULL' : 'BEAR'}
                        </Badge>
                    </div>
                    <p className="text-lg text-muted-foreground mb-1">{thesis.companyName}</p>
                    <p className="text-xl font-bold mb-2">{thesis.title}</p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span>Created {formatDate(thesis.dateCreated)}</span>
                        <span>•</span>
                        <span>Updated {formatDate(thesis.dateUpdated)}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                        Edit Thesis
                    </Button>
                    <Button size="sm" onClick={() => setEvidenceOpen(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Evidence
                    </Button>
                </div>
            </div>

            {/* Tags */}
            {thesis.tags.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                    {thesis.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                        </Badge>
                    ))}
                </div>
            )}

            {/* Top Metrics Row */}
            <div className="grid grid-cols-4 gap-4">
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Current Price</p>
                    <p className="text-2xl font-bold">
                        {typeof thesis.currentPrice === 'number'
                            ? `$${thesis.currentPrice.toFixed(2)}`
                            : '—'}
                    </p>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Target Price</p>
                    <p className="text-2xl font-bold text-primary">${thesis.targetPrice}</p>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">
                        {isPositiveThesis ? 'Upside' : 'Downside'}
                    </p>
                    <p
                        className={`text-2xl font-bold ${
                            upside === null
                                ? 'text-muted-foreground'
                                : isPositiveThesis
                                    ? 'text-primary'
                                    : 'text-destructive'
                        }`}
                    >
                        {upside === null ? '—' : `${upside}%`}
                    </p>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Time Horizon</p>
                    <p className="text-2xl font-bold">{thesis.timeHorizon || '—'}</p>
                </Card>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - Hypothesis & Cases */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Investment Hypothesis */}
                    <Card className="p-6">
                        <h3 className="font-bold text-lg mb-4">Investment Hypothesis</h3>
                        {thesis.hypothesis ? (
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                {thesis.hypothesis}
                            </p>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">
                                No hypothesis recorded yet. Edit the thesis to add one.
                            </p>
                        )}
                    </Card>

                    {/* Bull & Bear Cases */}
                    <div className="grid grid-cols-2 gap-6">
                        <Card className="p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <CheckCircle2 className="h-5 w-5 text-primary" />
                                </div>
                                <h3 className="font-bold text-lg">Evidence For</h3>
                            </div>
                            {thesis.bullCase.length > 0 ? (
                                <ul className="space-y-3">
                                    {thesis.bullCase.map((point, index) => (
                                        <li key={index} className="flex items-start gap-2 text-sm">
                                            <span className="text-primary mt-0.5">•</span>
                                            <span className="text-muted-foreground leading-relaxed">{point}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-muted-foreground italic">No bull points recorded.</p>
                            )}
                        </Card>

                        <Card className="p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-2 rounded-lg bg-destructive/10">
                                    <AlertCircle className="h-5 w-5 text-destructive" />
                                </div>
                                <h3 className="font-bold text-lg">Evidence Against</h3>
                            </div>
                            {thesis.bearCase.length > 0 ? (
                                <ul className="space-y-3">
                                    {thesis.bearCase.map((point, index) => (
                                        <li key={index} className="flex items-start gap-2 text-sm">
                                            <span className="text-destructive mt-0.5">•</span>
                                            <span className="text-muted-foreground leading-relaxed">{point}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-muted-foreground italic">No bear points recorded.</p>
                            )}
                        </Card>
                    </div>

                    {/* Linked Evidence */}
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-lg">Linked Evidence</h3>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEvidenceOpen(true)}
                                aria-label="Add evidence"
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Add
                            </Button>
                        </div>
                        {thesis.linkedEvidence.length > 0 ? (
                            <div className="space-y-2">
                                {thesis.linkedEvidence.map((evidence) => (
                                    <div
                                        key={evidence.id}
                                        className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/40 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-accent">
                                                {getTypeIcon(evidence.type)}
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm">{evidence.title}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {evidence.type.charAt(0).toUpperCase() + evidence.type.slice(1)} •{' '}
                                                    {evidence.date}
                                                </p>
                                            </div>
                                        </div>
                                        {evidence.url ? (
                                            <a
                                                href={evidence.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                aria-label={`Open ${evidence.title}`}
                                            >
                                                <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
                                            </a>
                                        ) : (
                                            <ExternalLink className="h-4 w-4 text-muted-foreground/40" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">
                                No evidence linked yet.
                            </p>
                        )}
                    </Card>
                </div>

                {/* Right Column - Health Score & Catalysts */}
                <div className="space-y-6">
                    {/* Health Score */}
                    <Card className="p-6">
                        <h3 className="font-bold text-lg mb-6">Health Score</h3>
                        <div className="flex flex-col items-center">
                            <div className="relative w-32 h-32">
                                <svg className="w-32 h-32 transform -rotate-90">
                                    <circle
                                        cx="64"
                                        cy="64"
                                        r="56"
                                        stroke="var(--accent)"
                                        strokeWidth="12"
                                        fill="none"
                                    />
                                    <circle
                                        cx="64"
                                        cy="64"
                                        r="56"
                                        stroke="#17cf54"
                                        strokeWidth="12"
                                        fill="none"
                                        strokeDasharray={`${2 * Math.PI * 56}`}
                                        strokeDashoffset={`${2 * Math.PI * 56 * (1 - thesis.healthScore / 100)}`}
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-3xl font-bold">{thesis.healthScore}</span>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground mt-4 text-center">
                                Based on evidence quality, thesis progress, and market conditions
                            </p>
                        </div>
                    </Card>

                    {/* Upcoming Catalysts */}
                    <Card className="p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Calendar className="h-5 w-5 text-primary" />
                            <h3 className="font-bold text-lg">Upcoming Catalysts</h3>
                        </div>
                        {thesis.catalysts.length > 0 ? (
                            <div className="space-y-3">
                                {thesis.catalysts.map((catalyst) => (
                                    <div key={catalyst.id} className="p-3 rounded-lg border border-border">
                                        <div className="flex items-start justify-between mb-2">
                                            <p className="font-medium text-sm">{catalyst.title}</p>
                                            <Badge className={`${getImpactColor(catalyst.impact)} text-xs`}>
                                                {catalyst.impact.toUpperCase()}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{catalyst.date}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">No catalysts tracked.</p>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full mt-4"
                            onClick={() => setCatalystOpen(true)}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Catalyst
                        </Button>
                    </Card>
                </div>
            </div>

            <NewThesisModal
                open={editOpen}
                onOpenChange={setEditOpen}
                editing={thesis}
                onSubmit={(draft) => update(thesis.id, draft)}
            />
            <AddCatalystModal
                open={catalystOpen}
                onOpenChange={setCatalystOpen}
                onSubmit={(catalyst) => addCatalyst(thesis.id, catalyst)}
            />
            <AddEvidenceModal
                open={evidenceOpen}
                onOpenChange={setEvidenceOpen}
                onSubmit={(evidence) => addEvidence(thesis.id, evidence)}
            />
        </div>
    );
}
