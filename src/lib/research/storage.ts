import type { Thesis } from './thesis';

/**
 * localStorage-backed persistence for theses until the Supabase-backed API
 * lands (AR-8). Separated from the React hook so we can unit-test the
 * reader / writer by passing a fake storage.
 */

export const THESIS_STORAGE_KEY = 'atlas:research:theses';

const CURRENT_VERSION = 1;

interface EnvelopeV1 {
    version: 1;
    theses: Thesis[];
}

function isThesis(value: unknown): value is Thesis {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
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

function parseEnvelope(raw: string): Thesis[] | null {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const envelope = parsed as Partial<EnvelopeV1>;
        if (envelope.version !== CURRENT_VERSION) return null;
        if (!Array.isArray(envelope.theses)) return null;
        const valid = envelope.theses.filter(isThesis);
        return valid.length === envelope.theses.length ? valid : null;
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
    const envelope: EnvelopeV1 = { version: CURRENT_VERSION, theses: [...theses] };
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
