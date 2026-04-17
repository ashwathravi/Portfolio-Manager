'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createJournalEntry,
    DEFAULT_JOURNAL_ENTRIES,
    deleteJournalEntry,
    sortJournalEntries,
    updateJournalEntry,
    type JournalDraft,
    type JournalEntry,
} from './journal';
import { getBrowserStorage } from './storage';
import { loadJournalFromStorage, saveJournalToStorage } from './journalStorage';

/**
 * React hook backing the decision journal. Persists to localStorage so
 * entries survive refreshes until the Supabase-backed API lands.
 */
export function useJournalStore() {
    const [entries, setEntries] = useState<JournalEntry[]>(DEFAULT_JOURNAL_ENTRIES);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        const stored = loadJournalFromStorage(getBrowserStorage());
        if (stored && stored.length > 0) {
            setEntries(stored);
        }
        setHydrated(true);
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        saveJournalToStorage(getBrowserStorage(), entries);
    }, [hydrated, entries]);

    const create = useCallback((draft: JournalDraft) => {
        setEntries((prev) => [createJournalEntry(draft), ...prev]);
    }, []);

    const update = useCallback((id: string, patch: Partial<JournalDraft>) => {
        setEntries((prev) => updateJournalEntry(prev, id, patch));
    }, []);

    const remove = useCallback((id: string) => {
        setEntries((prev) => deleteJournalEntry(prev, id));
    }, []);

    const sorted = useMemo(() => sortJournalEntries(entries), [entries]);

    return { entries: sorted, hydrated, create, update, remove };
}
