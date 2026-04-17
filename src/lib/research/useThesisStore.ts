'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    addCatalyst,
    addEvidence,
    archiveThesis,
    createThesis,
    deleteThesis,
    DEFAULT_THESES,
    findThesisByTicker,
    partitionTheses,
    restoreThesis,
    updateThesis,
    type Thesis,
    type ThesisCatalyst,
    type ThesisDraft,
    type ThesisEvidence,
} from './thesis';
import { getBrowserStorage, loadThesesFromStorage, saveThesesToStorage } from './storage';

/**
 * React hook that backs the research workspace. Persists to localStorage so
 * user changes survive a refresh until the Supabase-backed API lands.
 */
export function useThesisStore() {
    const [theses, setTheses] = useState<Thesis[]>(DEFAULT_THESES);
    const [hydrated, setHydrated] = useState(false);

    // Hydrate from localStorage on mount so SSR + initial render match.
    useEffect(() => {
        const stored = loadThesesFromStorage(getBrowserStorage());
        if (stored && stored.length > 0) {
            setTheses(stored);
        }
        setHydrated(true);
    }, []);

    // Persist any change after hydration — skipping the initial paint avoids
    // clobbering storage with the seed list before we've read from it.
    useEffect(() => {
        if (!hydrated) return;
        saveThesesToStorage(getBrowserStorage(), theses);
    }, [hydrated, theses]);

    const create = useCallback((draft: ThesisDraft) => {
        setTheses((prev) => [createThesis(draft), ...prev]);
    }, []);

    const update = useCallback((id: string, patch: Partial<ThesisDraft>) => {
        setTheses((prev) => updateThesis(prev, id, patch));
    }, []);

    const archive = useCallback((id: string) => {
        setTheses((prev) => archiveThesis(prev, id));
    }, []);

    const restore = useCallback((id: string) => {
        setTheses((prev) => restoreThesis(prev, id));
    }, []);

    const remove = useCallback((id: string) => {
        setTheses((prev) => deleteThesis(prev, id));
    }, []);

    const addCatalystTo = useCallback((thesisId: string, catalyst: Omit<ThesisCatalyst, 'id'>) => {
        setTheses((prev) => addCatalyst(prev, thesisId, catalyst));
    }, []);

    const addEvidenceTo = useCallback((thesisId: string, evidence: Omit<ThesisEvidence, 'id'>) => {
        setTheses((prev) => addEvidence(prev, thesisId, evidence));
    }, []);

    const findByTicker = useCallback(
        (ticker: string) => findThesisByTicker(theses, ticker),
        [theses],
    );

    const { active, archived } = useMemo(() => partitionTheses(theses), [theses]);

    return {
        theses,
        active,
        archived,
        hydrated,
        create,
        update,
        archive,
        restore,
        remove,
        addCatalyst: addCatalystTo,
        addEvidence: addEvidenceTo,
        findByTicker,
    };
}
