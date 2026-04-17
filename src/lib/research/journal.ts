/**
 * Decision-journal CRUD primitives. Pure (no DOM, no localStorage) so the
 * reducer is unit-testable and reusable from a future server-backed API.
 */

export type JournalDecisionType = 'entry' | 'exit' | 'hold';
export type JournalOutcome = 'win' | 'loss' | 'pending';

export interface JournalEntry {
    id: string;
    date: string;
    type: JournalDecisionType;
    ticker: string;
    decision: string;
    rationale: string;
    outcome: JournalOutcome;
    /** Optional pointer to a thesis in the thesis store. */
    thesisId?: string;
}

export interface JournalDraft {
    date?: string;
    type: JournalDecisionType;
    ticker: string;
    decision: string;
    rationale: string;
    outcome?: JournalOutcome;
    thesisId?: string;
}

function today(): string {
    return new Date().toISOString().split('T')[0];
}

function randomId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `journal-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Normalize a draft into a fresh journal entry with id and defaults. */
export function createJournalEntry(
    draft: JournalDraft,
    options: { id?: string; now?: () => string } = {},
): JournalEntry {
    const now = options.now ?? today;
    return {
        id: options.id ?? randomId(),
        date: draft.date?.trim() || now(),
        type: draft.type,
        ticker: draft.ticker.toUpperCase().trim(),
        decision: draft.decision.trim(),
        rationale: draft.rationale.trim(),
        outcome: draft.outcome ?? 'pending',
        thesisId: draft.thesisId,
    };
}

/**
 * Produce a new array with `id` updated. If the id is not present the list
 * is returned unchanged so stale modal submissions can't corrupt storage.
 */
export function updateJournalEntry(
    list: readonly JournalEntry[],
    id: string,
    patch: Partial<JournalDraft>,
): JournalEntry[] {
    return list.map((entry) => {
        if (entry.id !== id) return entry;
        return {
            ...entry,
            ...patch,
            ticker: patch.ticker ? patch.ticker.toUpperCase().trim() : entry.ticker,
            decision: patch.decision?.trim() ?? entry.decision,
            rationale: patch.rationale?.trim() ?? entry.rationale,
            date: patch.date?.trim() || entry.date,
        };
    });
}

export function deleteJournalEntry(list: readonly JournalEntry[], id: string): JournalEntry[] {
    return list.filter((entry) => entry.id !== id);
}

/** Sort by date descending so the newest entries appear first. */
export function sortJournalEntries(list: readonly JournalEntry[]): JournalEntry[] {
    return [...list].sort((a, b) => {
        if (a.date === b.date) return 0;
        return a.date > b.date ? -1 : 1;
    });
}

export function filterJournalByThesis(list: readonly JournalEntry[], thesisId: string): JournalEntry[] {
    return list.filter((entry) => entry.thesisId === thesisId);
}

/** Default seed data so the journal tab isn't empty on first load. */
export const DEFAULT_JOURNAL_ENTRIES: JournalEntry[] = [
    {
        id: 'seed-journal-1',
        date: '2026-02-05',
        type: 'entry',
        ticker: 'AAPL',
        decision: 'Increased position by 50 shares',
        rationale:
            'Strong iPhone sales data, expansion in services revenue. Vision Pro launch creating new product category with minimal competition.',
        outcome: 'pending',
    },
    {
        id: 'seed-journal-2',
        date: '2026-02-03',
        type: 'exit',
        ticker: 'TSLA',
        decision: 'Reduced position by 25 shares',
        rationale:
            'Taking profits after 20% gain, valuation concerns. Increased competition from legacy automakers and margin pressure from price cuts.',
        outcome: 'win',
        thesisId: 'seed-tsla',
    },
    {
        id: 'seed-journal-3',
        date: '2026-01-28',
        type: 'entry',
        ticker: 'NVDA',
        decision: 'Opened position with 20 shares',
        rationale:
            'AI data center demand exceeding expectations. CUDA moat remains strong. H100 supply constraints supporting ASPs.',
        outcome: 'pending',
        thesisId: 'seed-nvda',
    },
    {
        id: 'seed-journal-4',
        date: '2026-01-20',
        type: 'hold',
        ticker: 'MSFT',
        decision: 'Maintaining position through earnings',
        rationale:
            'Azure AI services showing strong adoption. Copilot revenue ramping. Cloud margin expansion narrative intact.',
        outcome: 'pending',
        thesisId: 'seed-msft',
    },
];
