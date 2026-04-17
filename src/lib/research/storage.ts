import type { Thesis, ThesisCatalyst, ThesisEvidence } from './thesis';

/**
 * localStorage-backed persistence for theses until the Supabase-backed API
 * lands (AR-8). Separated from the React hook so we can unit-test the
 * reader / writer by passing a fake storage.
 */

export const THESIS_STORAGE_KEY = 'atlas:research:theses';

const CURRENT_VERSION = 2;

interface EnvelopeV1 {
    version: 1;
    theses: Array<Record<string, unknown>>;
}

interface EnvelopeV2 {
    version: 2;
    theses: Thesis[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasCoreThesisShape(v: Record<string, unknown>): boolean {
    return (
        typeof v.id === 'string' &&
        typeof v.ticker === 'string' &&
        typeof v.companyName === 'string' &&
        typeof v.title === 'string' &&
        typeof v.targetPrice === 'number' &&
        (v.type === 'bull' || v.type === 'bear') &&
        (v.conviction === 'HIGH' || v.conviction === 'MEDIUM' || v.conviction === 'LOW') &&
        (v.status === 'active' || v.status === 'monitoring' || v.status === 'archived')
    );
}

function ensureStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
}

function ensureCatalysts(value: unknown): ThesisCatalyst[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(isRecord)
        .map((c) => ({
            id: typeof c.id === 'string' ? c.id : `cat-${Math.random().toString(36).slice(2, 10)}`,
            title: typeof c.title === 'string' ? c.title : '',
            date: typeof c.date === 'string' ? c.date : '',
            impact: c.impact === 'high' || c.impact === 'medium' || c.impact === 'low' ? c.impact : 'medium',
        }));
}

function ensureEvidence(value: unknown): ThesisEvidence[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord).map((e): ThesisEvidence => {
        const base: ThesisEvidence = {
            id: typeof e.id === 'string' ? e.id : `ev-${Math.random().toString(36).slice(2, 10)}`,
            title: typeof e.title === 'string' ? e.title : '',
            type:
                e.type === 'article' || e.type === 'report' || e.type === 'earnings' || e.type === 'note'
                    ? e.type
                    : 'note',
            date: typeof e.date === 'string' ? e.date : '',
        };
        if (typeof e.url === 'string') base.url = e.url;
        return base;
    });
}

/** Take a raw record (v1 or v2 shape) and return a fully-formed Thesis with defaults filled in. */
function normalizeThesis(raw: Record<string, unknown>): Thesis | null {
    if (!hasCoreThesisShape(raw)) return null;
    return {
        id: raw.id as string,
        ticker: raw.ticker as string,
        companyName: raw.companyName as string,
        title: raw.title as string,
        description: typeof raw.description === 'string' ? raw.description : '',
        type: raw.type as Thesis['type'],
        status: raw.status as Thesis['status'],
        conviction: raw.conviction as Thesis['conviction'],
        targetPrice: raw.targetPrice as number,
        currentPrice: typeof raw.currentPrice === 'number' ? raw.currentPrice : undefined,
        timeHorizon: typeof raw.timeHorizon === 'string' ? raw.timeHorizon : '',
        dateCreated: typeof raw.dateCreated === 'string'
            ? raw.dateCreated
            : typeof raw.dateUpdated === 'string'
                ? raw.dateUpdated
                : '',
        dateUpdated: typeof raw.dateUpdated === 'string' ? raw.dateUpdated : '',
        tags: ensureStringArray(raw.tags),
        hypothesis: typeof raw.hypothesis === 'string' ? raw.hypothesis : '',
        bullCase: ensureStringArray(raw.bullCase),
        bearCase: ensureStringArray(raw.bearCase),
        catalysts: ensureCatalysts(raw.catalysts),
        linkedEvidence: ensureEvidence(raw.linkedEvidence),
        healthScore: typeof raw.healthScore === 'number' ? raw.healthScore : 50,
    };
}

function parseEnvelope(raw: string): Thesis[] | null {
    try {
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) return null;
        const envelope = parsed as Partial<EnvelopeV1 & EnvelopeV2>;
        if (envelope.version !== 1 && envelope.version !== CURRENT_VERSION) return null;
        if (!Array.isArray(envelope.theses)) return null;
        const normalized: Thesis[] = [];
        for (const entry of envelope.theses) {
            if (!isRecord(entry)) return null;
            const thesis = normalizeThesis(entry);
            if (!thesis) return null;
            normalized.push(thesis);
        }
        return normalized;
    } catch {
        return null;
    }
}

export function loadThesesFromStorage(storage: Pick<Storage, 'getItem'> | null | undefined): Thesis[] | null {
    if (!storage) return null;
    const raw = storage.getItem(THESIS_STORAGE_KEY);
    if (!raw) return null;
    return parseEnvelope(raw);
}

export function saveThesesToStorage(
    storage: Pick<Storage, 'setItem'> | null | undefined,
    theses: readonly Thesis[],
): void {
    if (!storage) return;
    const envelope: EnvelopeV2 = { version: CURRENT_VERSION, theses: [...theses] };
    storage.setItem(THESIS_STORAGE_KEY, JSON.stringify(envelope));
}

/** Helper to reach the browser localStorage object safely in SSR contexts. */
export function getBrowserStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        // Accessing localStorage can throw on some strict privacy modes.
        return null;
    }
}
