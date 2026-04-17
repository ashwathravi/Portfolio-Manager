/**
 * Thesis CRUD primitives used by the research workspace. Keeping this file
 * pure (no DOM, no localStorage) makes the reducer easy to unit-test and
 * reusable from a future server-driven implementation.
 */

export type ThesisDirection = 'bull' | 'bear';
export type ThesisConviction = 'HIGH' | 'MEDIUM' | 'LOW';
export type ThesisStatus = 'active' | 'monitoring' | 'archived';
export type CatalystImpact = 'high' | 'medium' | 'low';
export type EvidenceType = 'article' | 'report' | 'earnings' | 'note';

export interface ThesisCatalyst {
    id: string;
    title: string;
    date: string;
    impact: CatalystImpact;
}

export interface ThesisEvidence {
    id: string;
    title: string;
    type: EvidenceType;
    date: string;
    url?: string;
}

export interface Thesis {
    id: string;
    ticker: string;
    companyName: string;
    title: string;
    description: string;
    type: ThesisDirection;
    status: ThesisStatus;
    conviction: ThesisConviction;
    targetPrice: number;
    currentPrice?: number;
    timeHorizon: string;
    dateCreated: string;
    dateUpdated: string;
    tags: string[];
    hypothesis: string;
    bullCase: string[];
    bearCase: string[];
    catalysts: ThesisCatalyst[];
    linkedEvidence: ThesisEvidence[];
    healthScore: number;
}

export interface ThesisDraft {
    ticker: string;
    companyName: string;
    title: string;
    description: string;
    type: ThesisDirection;
    conviction: ThesisConviction;
    targetPrice: number;
    timeHorizon: string;
    tags?: string[];
    currentPrice?: number;
    hypothesis?: string;
    bullCase?: string[];
    bearCase?: string[];
    catalysts?: ThesisCatalyst[];
    linkedEvidence?: ThesisEvidence[];
    healthScore?: number;
}

function today(): string {
    return new Date().toISOString().split('T')[0];
}

function randomId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `thesis-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Normalize a draft into a fresh `Thesis` with id, status, and timestamps. */
export function createThesis(
    draft: ThesisDraft,
    options: { id?: string; now?: () => string } = {},
): Thesis {
    const now = options.now ?? today;
    const stamp = now();
    return {
        id: options.id ?? randomId(),
        ticker: draft.ticker.toUpperCase().trim(),
        companyName: draft.companyName.trim(),
        title: draft.title.trim(),
        description: draft.description.trim(),
        type: draft.type,
        status: 'active',
        conviction: draft.conviction,
        targetPrice: draft.targetPrice,
        currentPrice: draft.currentPrice,
        timeHorizon: draft.timeHorizon,
        dateCreated: stamp,
        dateUpdated: stamp,
        tags: draft.tags ?? [],
        hypothesis: draft.hypothesis ?? '',
        bullCase: draft.bullCase ?? [],
        bearCase: draft.bearCase ?? [],
        catalysts: draft.catalysts ?? [],
        linkedEvidence: draft.linkedEvidence ?? [],
        healthScore: draft.healthScore ?? 50,
    };
}

/**
 * Produce a new array with `id` updated in place. If the id is not present
 * the list is returned unchanged so callers don't need to guard against
 * stale ids from a closed modal.
 */
export function updateThesis(
    list: readonly Thesis[],
    id: string,
    patch: Partial<ThesisDraft>,
    options: { now?: () => string } = {},
): Thesis[] {
    const now = options.now ?? today;
    return list.map((t) => {
        if (t.id !== id) return t;
        return {
            ...t,
            ...patch,
            ticker: patch.ticker ? patch.ticker.toUpperCase().trim() : t.ticker,
            tags: patch.tags ?? t.tags,
            bullCase: patch.bullCase ?? t.bullCase,
            bearCase: patch.bearCase ?? t.bearCase,
            catalysts: patch.catalysts ?? t.catalysts,
            linkedEvidence: patch.linkedEvidence ?? t.linkedEvidence,
            dateUpdated: now(),
        };
    });
}

export function archiveThesis(
    list: readonly Thesis[],
    id: string,
    options: { now?: () => string } = {},
): Thesis[] {
    const now = options.now ?? today;
    return list.map((t) => (t.id === id ? { ...t, status: 'archived' as const, dateUpdated: now() } : t));
}

export function restoreThesis(
    list: readonly Thesis[],
    id: string,
    options: { now?: () => string } = {},
): Thesis[] {
    const now = options.now ?? today;
    return list.map((t) => (t.id === id ? { ...t, status: 'active' as const, dateUpdated: now() } : t));
}

export function deleteThesis(list: readonly Thesis[], id: string): Thesis[] {
    return list.filter((t) => t.id !== id);
}

export function partitionTheses(list: readonly Thesis[]): { active: Thesis[]; archived: Thesis[] } {
    const active: Thesis[] = [];
    const archived: Thesis[] = [];
    for (const t of list) {
        if (t.status === 'archived') archived.push(t);
        else active.push(t);
    }
    return { active, archived };
}

export function findThesisByTicker(list: readonly Thesis[], ticker: string): Thesis | undefined {
    const needle = ticker.toUpperCase().trim();
    return list.find((t) => t.ticker === needle);
}

export function addCatalyst(
    list: readonly Thesis[],
    thesisId: string,
    catalyst: Omit<ThesisCatalyst, 'id'>,
    options: { id?: string; now?: () => string } = {},
): Thesis[] {
    const now = options.now ?? today;
    return list.map((t) => {
        if (t.id !== thesisId) return t;
        return {
            ...t,
            catalysts: [...t.catalysts, { ...catalyst, id: options.id ?? randomId() }],
            dateUpdated: now(),
        };
    });
}

export function addEvidence(
    list: readonly Thesis[],
    thesisId: string,
    evidence: Omit<ThesisEvidence, 'id'>,
    options: { id?: string; now?: () => string } = {},
): Thesis[] {
    const now = options.now ?? today;
    return list.map((t) => {
        if (t.id !== thesisId) return t;
        return {
            ...t,
            linkedEvidence: [{ ...evidence, id: options.id ?? randomId() }, ...t.linkedEvidence],
            dateUpdated: now(),
        };
    });
}

/** Default data used to seed the research workspace on first load. */
export const DEFAULT_THESES: Thesis[] = [
    {
        id: 'seed-nvda',
        ticker: 'NVDA',
        companyName: 'NVIDIA Corporation',
        title: 'AI Infrastructure Dominance',
        description:
            'NVIDIA is uniquely positioned to capture majority of Data Center AI spend due to CUDA moat and H100 rollout. Supply constraints will support high ASPs through 2024.',
        type: 'bull',
        status: 'active',
        conviction: 'HIGH',
        targetPrice: 950,
        currentPrice: 875.28,
        timeHorizon: '18-24 months',
        dateCreated: '2023-12-15',
        dateUpdated: '2024-02-01',
        tags: ['AI', 'Semiconductors', 'Data Center'],
        hypothesis:
            'NVIDIA will maintain 80%+ market share in Data Center AI accelerators through 2025, driven by CUDA ecosystem lock-in, superior performance/watt, and H100/H200 supply advantages. Expect 40%+ revenue CAGR with expanding operating margins as software/services mix increases.',
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
            { id: 'cat-nvda-1', title: 'Q4 FY24 Earnings', date: '2024-02-21', impact: 'high' },
            { id: 'cat-nvda-2', title: 'GTC Conference', date: '2024-03-18', impact: 'high' },
            { id: 'cat-nvda-3', title: 'H200 Production Ramp', date: 'Q2 2024', impact: 'medium' },
            { id: 'cat-nvda-4', title: 'Automotive Design Wins', date: 'Q3 2024', impact: 'medium' },
        ],
        linkedEvidence: [
            { id: 'ev-nvda-1', title: 'Q3 FY24 Earnings Transcript Analysis', type: 'earnings', date: '2023-11-21' },
            { id: 'ev-nvda-2', title: 'Azure AI Infrastructure Deep Dive', type: 'report', date: '2024-01-10' },
            { id: 'ev-nvda-3', title: 'CUDA Ecosystem Competitive Analysis', type: 'note', date: '2023-12-05' },
            { id: 'ev-nvda-4', title: 'AMD MI300 Benchmark Comparison', type: 'article', date: '2024-01-28' },
        ],
        healthScore: 85,
    },
    {
        id: 'seed-tsla',
        ticker: 'TSLA',
        companyName: 'Tesla, Inc.',
        title: 'Margin Compression Concerns',
        description:
            'Increased competition in EV space and aggressive price cuts will compress auto gross margins below 15%. FSD revenue recognition is delayed.',
        type: 'bear',
        status: 'active',
        conviction: 'MEDIUM',
        targetPrice: 180,
        currentPrice: 212.08,
        timeHorizon: '12 months',
        dateCreated: '2024-01-05',
        dateUpdated: '2024-02-05',
        tags: ['EV', 'Automotive', 'Competition'],
        hypothesis:
            "Tesla's automotive margins will compress to sub-15% levels as competition intensifies and pricing power diminishes. FSD monetization delays and reduced regulatory credit revenue will further pressure profitability. Target 20x P/E multiple implies $180 price target.",
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
            { id: 'cat-tsla-1', title: 'Q4 2023 Earnings', date: '2024-01-24', impact: 'high' },
            { id: 'cat-tsla-2', title: 'Cybertruck Production Update', date: '2024-03-01', impact: 'medium' },
            { id: 'cat-tsla-3', title: 'China Sales Data', date: 'Monthly', impact: 'high' },
        ],
        linkedEvidence: [
            { id: 'ev-tsla-1', title: 'Q4 2023 Earnings Analysis', type: 'earnings', date: '2024-01-24' },
            { id: 'ev-tsla-2', title: 'BYD Competitive Positioning', type: 'report', date: '2024-01-15' },
            { id: 'ev-tsla-3', title: 'EV Pricing Trends Analysis', type: 'article', date: '2024-02-01' },
        ],
        healthScore: 62,
    },
    {
        id: 'seed-msft',
        ticker: 'MSFT',
        companyName: 'Microsoft Corporation',
        title: 'Azure AI Growth Acceleration',
        description:
            'Azure AI services and GitHub Copilot driving incremental $10B+ revenue. Enterprise AI adoption cycle just beginning with strong competitive positioning.',
        type: 'bull',
        status: 'active',
        conviction: 'HIGH',
        targetPrice: 485,
        currentPrice: 420.55,
        timeHorizon: '24 months',
        dateCreated: '2023-11-20',
        dateUpdated: '2024-01-28',
        tags: ['Cloud', 'AI', 'Enterprise'],
        hypothesis:
            'Microsoft will monetize AI capabilities across Azure, Office 365, and GitHub to generate incremental $15B+ revenue by FY2025. OpenAI partnership provides competitive moat in enterprise AI, driving Azure consumption growth reacceleration to 30%+.',
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
            { id: 'cat-msft-1', title: 'Q2 FY24 Earnings', date: '2024-01-30', impact: 'high' },
            { id: 'cat-msft-2', title: 'Copilot Enterprise Launch', date: '2024-02-15', impact: 'high' },
            { id: 'cat-msft-3', title: 'Build Conference', date: '2024-05-21', impact: 'medium' },
        ],
        linkedEvidence: [
            { id: 'ev-msft-1', title: 'Q1 FY24 Earnings Deep Dive', type: 'earnings', date: '2023-10-24' },
            { id: 'ev-msft-2', title: 'Copilot Adoption Survey Results', type: 'report', date: '2024-01-10' },
            { id: 'ev-msft-3', title: 'Azure AI Competitive Landscape', type: 'note', date: '2024-01-22' },
        ],
        healthScore: 88,
    },
    {
        id: 'seed-meta',
        ticker: 'META',
        companyName: 'Meta Platforms, Inc.',
        title: 'Metaverse Pivot Risk',
        description:
            'Heavy CapEx on metaverse initiatives with unclear ROI. Reality Labs losses exceeding $10B annually.',
        type: 'bear',
        status: 'archived',
        conviction: 'MEDIUM',
        targetPrice: 180,
        timeHorizon: '12 months',
        dateCreated: '2023-10-01',
        dateUpdated: '2023-12-15',
        tags: ['Social Media', 'Metaverse', 'CapEx'],
        hypothesis:
            'Meta will struggle to justify $15B+ annual Reality Labs losses. Ad market recovery should offset some pain but the metaverse bet is unlikely to pay off on the 12-month horizon.',
        bullCase: [
            'Ad revenue growth reaccelerating as engagement metrics improve',
            'Cost discipline returning across the core Family of Apps business',
        ],
        bearCase: [
            'Reality Labs losses still accelerating with no clear revenue path',
            'Regulatory scrutiny around Threads and the metaverse data practices',
            'Apple privacy changes continue to pressure targeting efficiency',
        ],
        catalysts: [
            { id: 'cat-meta-1', title: 'Q4 2023 Earnings', date: '2024-02-01', impact: 'high' },
        ],
        linkedEvidence: [
            { id: 'ev-meta-1', title: 'Reality Labs Segment Deep Dive', type: 'report', date: '2023-11-15' },
        ],
        healthScore: 45,
    },
];
