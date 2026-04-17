/**
 * Thesis CRUD primitives used by the research workspace. Keeping this file
 * pure (no DOM, no localStorage) makes the reducer easy to unit-test and
 * reusable from a future server-driven implementation.
 */

export type ThesisDirection = 'bull' | 'bear';
export type ThesisConviction = 'HIGH' | 'MEDIUM' | 'LOW';
export type ThesisStatus = 'active' | 'monitoring' | 'archived';

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
    timeHorizon: string;
    dateUpdated: string;
    tags: string[];
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
        timeHorizon: draft.timeHorizon,
        dateUpdated: now(),
        tags: draft.tags ?? [],
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
        timeHorizon: '18-24 months',
        dateUpdated: '2024-02-01',
        tags: ['AI', 'Semiconductors', 'Data Center'],
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
        timeHorizon: '12 months',
        dateUpdated: '2024-02-05',
        tags: ['EV', 'Automotive', 'Competition'],
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
        timeHorizon: '24 months',
        dateUpdated: '2024-01-28',
        tags: ['Cloud', 'AI', 'Enterprise'],
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
        dateUpdated: '2023-12-15',
        tags: ['Social Media', 'Metaverse', 'CapEx'],
    },
];
