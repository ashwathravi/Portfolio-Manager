'use client';

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

interface ThesisDetailData {
    ticker: string;
    companyName: string;
    title: string;
    description: string;
    type: 'bull' | 'bear';
    conviction: 'HIGH' | 'MEDIUM' | 'LOW';
    targetPrice: number;
    currentPrice: number;
    timeHorizon: string;
    dateCreated: string;
    dateUpdated: string;
    tags: string[];
    healthScore: number;
    hypothesis: string;
    bullCase: string[];
    bearCase: string[];
    catalysts: Array<{
        title: string;
        date: string;
        impact: 'high' | 'medium' | 'low';
    }>;
    linkedEvidence: Array<{
        title: string;
        type: 'article' | 'report' | 'earnings' | 'note';
        date: string;
        url?: string;
    }>;
}

const mockThesisData: Record<string, ThesisDetailData> = {
    NVDA: {
        ticker: 'NVDA',
        companyName: 'NVIDIA Corporation',
        title: 'AI Infrastructure Dominance',
        description: 'NVIDIA is uniquely positioned to capture majority of Data Center AI spend due to CUDA moat and H100 rollout.',
        type: 'bull',
        conviction: 'HIGH',
        targetPrice: 950,
        currentPrice: 875.28,
        timeHorizon: '18-24 months',
        dateCreated: '12/15/2023',
        dateUpdated: '2/1/2024',
        tags: ['AI', 'Semiconductors', 'Data Center'],
        healthScore: 85,
        hypothesis: 'NVIDIA will maintain 80%+ market share in Data Center AI accelerators through 2025, driven by CUDA ecosystem lock-in, superior performance/watt, and H100/H200 supply advantages. Expect 40%+ revenue CAGR with expanding operating margins as software/services mix increases.',
        bullCase: [
            'CUDA moat creates 18-24 month switching cost for enterprises already invested in NVIDIA infrastructure',
            'H100 supply constraints keeping ASPs elevated; H200 launch will extend premium pricing through H2 2024',
            'Azure, AWS, GCP continuing to expand AI infrastructure spend at 50%+ growth rates',
            'Software attach (AI Enterprise, Omniverse) reaching $1B+ ARR with 70%+ gross margins',
            'Automotive and edge AI creating additional TAM expansion beyond data center',
        ],
        bearCase: [
            'AMD MI300 gaining traction with hyperscalers looking to diversify supply chain',
            'Custom AI chips (Google TPU, Amazon Trainium) reducing dependence on NVIDIA',
            'Gross margins could compress if competition forces pricing concessions',
            'Geopolitical risks with China export restrictions limiting TAM',
            'Valuation at 35x forward earnings leaves limited margin of safety',
        ],
        catalysts: [
            { title: 'Q4 FY24 Earnings (Feb 21)', date: '2/21/2024', impact: 'high' },
            { title: 'GTC Conference', date: '3/18/2024', impact: 'high' },
            { title: 'H200 Production Ramp', date: 'Q2 2024', impact: 'medium' },
            { title: 'Automotive Design Wins', date: 'Q3 2024', impact: 'medium' },
        ],
        linkedEvidence: [
            {
                title: 'Q3 FY24 Earnings Transcript Analysis',
                type: 'earnings',
                date: '11/21/2023',
            },
            {
                title: 'Azure AI Infrastructure Deep Dive',
                type: 'report',
                date: '1/10/2024',
            },
            {
                title: 'CUDA Ecosystem Competitive Analysis',
                type: 'note',
                date: '12/5/2023',
            },
            {
                title: 'AMD MI300 Benchmark Comparison',
                type: 'article',
                date: '1/28/2024',
            },
        ],
    },
    TSLA: {
        ticker: 'TSLA',
        companyName: 'Tesla, Inc.',
        title: 'Margin Compression Concerns',
        description: 'Increased competition in EV space and aggressive price cuts will compress auto gross margins below 15%.',
        type: 'bear',
        conviction: 'MEDIUM',
        targetPrice: 180,
        currentPrice: 212.08,
        timeHorizon: '12 months',
        dateCreated: '1/5/2024',
        dateUpdated: '2/5/2024',
        tags: ['EV', 'Automotive', 'Competition'],
        healthScore: 62,
        hypothesis: 'Tesla\'s automotive margins will compress to sub-15% levels as competition intensifies and pricing power diminishes. FSD monetization delays and reduced regulatory credit revenue will further pressure profitability. Target 20x P/E multiple implies $180 price target.',
        bullCase: [
            'FSD Version 12 showing significant improvement, potential for licensing revenue',
            'Cybertruck production ramp could drive mix improvement',
            'Energy storage business growing faster than automotive',
        ],
        bearCase: [
            'BYD and Chinese EV makers offering comparable vehicles at 30-40% lower prices',
            'Legacy automakers (Ford, GM) achieving price parity with EV offerings',
            'Price cuts in Q1 2024 signal weakening demand elasticity',
            'FSD revenue recognition pushed back again, limited near-term contribution',
            'Regulatory credit revenue declining as other OEMs meet requirements',
        ],
        catalysts: [
            { title: 'Q4 2023 Earnings', date: '1/24/2024', impact: 'high' },
            { title: 'Cybertruck Production Update', date: '3/1/2024', impact: 'medium' },
            { title: 'China Sales Data', date: 'Monthly', impact: 'high' },
        ],
        linkedEvidence: [
            {
                title: 'Q4 2023 Earnings Analysis',
                type: 'earnings',
                date: '1/24/2024',
            },
            {
                title: 'BYD Competitive Positioning',
                type: 'report',
                date: '1/15/2024',
            },
            {
                title: 'EV Pricing Trends Analysis',
                type: 'article',
                date: '2/1/2024',
            },
        ],
    },
    MSFT: {
        ticker: 'MSFT',
        companyName: 'Microsoft Corporation',
        title: 'Azure AI Growth Acceleration',
        description: 'Azure AI services and GitHub Copilot driving incremental $10B+ revenue.',
        type: 'bull',
        conviction: 'HIGH',
        targetPrice: 485,
        currentPrice: 420.55,
        timeHorizon: '24 months',
        dateCreated: '11/20/2023',
        dateUpdated: '1/28/2024',
        tags: ['Cloud', 'AI', 'Enterprise'],
        healthScore: 88,
        hypothesis: 'Microsoft will monetize AI capabilities across Azure, Office 365, and GitHub to generate incremental $15B+ revenue by FY2025. OpenAI partnership provides competitive moat in enterprise AI, driving Azure consumption growth reacceleration to 30%+.',
        bullCase: [
            'Copilot for Microsoft 365 reaching 10M+ paid seats by end of FY24',
            'Azure AI services growing 100%+ YoY with strong retention',
            'OpenAI exclusive partnership creating differentiated enterprise offering',
            'GitHub Copilot expanding beyond developers to broader knowledge workers',
            'Security + AI bundle driving Office 365 ARPU expansion',
        ],
        bearCase: [
            'Google Workspace integration with Gemini could slow Office market share gains',
            'OpenAI infrastructure costs pressuring Azure margins short-term',
            'Enterprise AI adoption slower than expected due to governance concerns',
        ],
        catalysts: [
            { title: 'Q2 FY24 Earnings', date: '1/30/2024', impact: 'high' },
            { title: 'Copilot Enterprise Launch', date: '2/15/2024', impact: 'high' },
            { title: 'Build Conference', date: '5/21/2024', impact: 'medium' },
        ],
        linkedEvidence: [
            {
                title: 'Q1 FY24 Earnings Deep Dive',
                type: 'earnings',
                date: '10/24/2023',
            },
            {
                title: 'Copilot Adoption Survey Results',
                type: 'report',
                date: '1/10/2024',
            },
            {
                title: 'Azure AI Competitive Landscape',
                type: 'note',
                date: '1/22/2024',
            },
        ],
    },
};

export default function ThesisDetailPage() {
    const router = useRouter();
    const params = useParams();

    // Extract ticker from URL parameters
    const ticker = params.ticker as string || '';
    const thesis = mockThesisData[ticker];

    if (!thesis) {
        return (
            <div className="flex h-full items-center justify-center p-12">
                <p className="text-muted-foreground">Thesis not found for ticker: {ticker}</p>
            </div>
        );
    }

    const getConvictionColor = (conviction: string) => {
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
    };

    const getImpactColor = (impact: string) => {
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
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'article':
                return <FileText className="h-4 w-4" />;
            case 'report':
                return <FileText className="h-4 w-4" />;
            case 'earnings':
                return <TrendingUp className="h-4 w-4" />;
            case 'note':
                return <FileText className="h-4 w-4" />;
            default:
                return <FileText className="h-4 w-4" />;
        }
    };

    const upside = ((thesis.targetPrice - thesis.currentPrice) / thesis.currentPrice * 100).toFixed(1);
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
                        <span>Created {thesis.dateCreated}</span>
                        <span>•</span>
                        <span>Updated {thesis.dateUpdated}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                        Edit Thesis
                    </Button>
                    <Button size="sm">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Evidence
                    </Button>
                </div>
            </div>

            {/* Tags */}
            <div className="flex items-center gap-2">
                {thesis.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                    </Badge>
                ))}
            </div>

            {/* Top Metrics Row */}
            <div className="grid grid-cols-4 gap-4">
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Current Price</p>
                    <p className="text-2xl font-bold">${thesis.currentPrice.toFixed(2)}</p>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Target Price</p>
                    <p className="text-2xl font-bold text-primary">${thesis.targetPrice}</p>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">
                        {isPositiveThesis ? 'Upside' : 'Downside'}
                    </p>
                    <p className={`text-2xl font-bold ${isPositiveThesis ? 'text-primary' : 'text-destructive'}`}>
                        {upside}%
                    </p>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Time Horizon</p>
                    <p className="text-2xl font-bold">{thesis.timeHorizon}</p>
                </Card>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - Hypothesis & Cases */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Investment Hypothesis */}
                    <Card className="p-6">
                        <h3 className="font-bold text-lg mb-4">Investment Hypothesis</h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {thesis.hypothesis}
                        </p>
                    </Card>

                    {/* Bull & Bear Cases */}
                    <div className="grid grid-cols-2 gap-6">
                        {/* Bull Case */}
                        <Card className="p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <CheckCircle2 className="h-5 w-5 text-primary" />
                                </div>
                                <h3 className="font-bold text-lg">Evidence For</h3>
                            </div>
                            <ul className="space-y-3">
                                {thesis.bullCase.map((point, index) => (
                                    <li key={index} className="flex items-start gap-2 text-sm">
                                        <span className="text-primary mt-0.5">•</span>
                                        <span className="text-muted-foreground leading-relaxed">{point}</span>
                                    </li>
                                ))}
                            </ul>
                        </Card>

                        {/* Bear Case */}
                        <Card className="p-6">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="p-2 rounded-lg bg-destructive/10">
                                    <AlertCircle className="h-5 w-5 text-destructive" />
                                </div>
                                <h3 className="font-bold text-lg">Evidence Against</h3>
                            </div>
                            <ul className="space-y-3">
                                {thesis.bearCase.map((point, index) => (
                                    <li key={index} className="flex items-start gap-2 text-sm">
                                        <span className="text-destructive mt-0.5">•</span>
                                        <span className="text-muted-foreground leading-relaxed">{point}</span>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    </div>

                    {/* Linked Evidence */}
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-lg">Linked Evidence</h3>
                            <Button variant="ghost" size="sm">
                                View All
                            </Button>
                        </div>
                        <div className="space-y-2">
                            {thesis.linkedEvidence.map((evidence, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary/40 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-accent">
                                            {getTypeIcon(evidence.type)}
                                        </div>
                                        <div>
                                            <p className="font-medium text-sm">{evidence.title}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {evidence.type.charAt(0).toUpperCase() + evidence.type.slice(1)} • {evidence.date}
                                            </p>
                                        </div>
                                    </div>
                                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>

                {/* Right Column - Health Score & Catalysts */}
                <div className="space-y-6">
                    {/* Health Score */}
                    <Card className="p-6">
                        <h3 className="font-bold text-lg mb-6">Health Score</h3>
                        <div className="flex flex-col items-center">
                            <div className="relative w-32 h-32">
                                {/* Circular Progress */}
                                <svg className="w-32 h-32 transform -rotate-90">
                                    <circle
                                        cx="64"
                                        cy="64"
                                        r="56"
                                        stroke="hsl(var(--accent))"
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
                        <div className="space-y-3">
                            {thesis.catalysts.map((catalyst, index) => (
                                <div
                                    key={index}
                                    className="p-3 rounded-lg border border-border"
                                >
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
                        <Button variant="outline" size="sm" className="w-full mt-4">
                            <Plus className="h-4 w-4 mr-2" />
                            Add Catalyst
                        </Button>
                    </Card>
                </div>
            </div>
        </div>
    );
}
