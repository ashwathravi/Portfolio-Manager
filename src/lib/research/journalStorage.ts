import type { JournalEntry } from './journal';

/**
 * localStorage-backed persistence for decision-journal entries until the
 * Supabase-backed API lands. Mirrors the shape used for theses so future
 * migration is straightforward.
 */

export const JOURNAL_STORAGE_KEY = 'atlas:research:journal';

const CURRENT_VERSION = 1;

interface EnvelopeV1 {
    version: 1;
    entries: JournalEntry[];
}

function isJournalEntry(value: unknown): value is JournalEntry {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.id === 'string' &&
        typeof v.date === 'string' &&
        typeof v.ticker === 'string' &&
        typeof v.decision === 'string' &&
        typeof v.rationale === 'string' &&
        (v.type === 'entry' || v.type === 'exit' || v.type === 'hold') &&
        (v.outcome === 'win' || v.outcome === 'loss' || v.outcome === 'pending')
    );
}

function parseEnvelope(raw: string): JournalEntry[] | null {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const envelope = parsed as Partial<EnvelopeV1>;
        if (envelope.version !== CURRENT_VERSION) return null;
        if (!Array.isArray(envelope.entries)) return null;
        const valid = envelope.entries.filter(isJournalEntry);
        return valid.length === envelope.entries.length ? valid : null;
    } catch {
        return null;
    }
}

export function loadJournalFromStorage(
    storage: Pick<Storage, 'getItem'> | null | undefined,
): JournalEntry[] | null {
    if (!storage) return null;
    const raw = storage.getItem(JOURNAL_STORAGE_KEY);
    if (!raw) return null;
    return parseEnvelope(raw);
}

export function saveJournalToStorage(
    storage: Pick<Storage, 'setItem'> | null | undefined,
    entries: readonly JournalEntry[],
): void {
    if (!storage) return;
    const envelope: EnvelopeV1 = { version: CURRENT_VERSION, entries: [...entries] };
    storage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(envelope));
}
