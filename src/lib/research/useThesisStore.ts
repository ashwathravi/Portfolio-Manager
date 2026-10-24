'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAccountStorage, useViewerIdentity } from '@/components/providers/IdentityProvider';
import { useRequestTime } from '@/components/providers/RequestTimeProvider';
import { storageScopeFor } from '@/lib/storage/user-scope';
import {
    addCatalyst,
    addEvidence,
    archiveThesis,
    createThesis,
    deleteThesis,
    findThesisByTicker,
    getDefaultTheses,
    partitionTheses,
    restoreThesis,
    updateThesis,
    type Thesis,
    type ThesisCatalyst,
    type ThesisDraft,
    type ThesisEvidence,
} from './thesis';
import { getBrowserStorage, loadThesesFromStorage, saveThesesToStorage } from './storage';
import {
    applyThesisWrite,
    childLimitMessage,
    fetchAccountTheses,
    importBrowserTheses,
    mergeAccountTheses,
    sendThesisWrite,
    toThesisInput,
    type AccountTheses,
    type ThesisWrite,
} from './thesisAccount';
import { useAccountRecords } from './useAccountRecords';

const ACCOUNT_QUERY = ['research', 'theses'] as const;

/** Where the theses live: how to read them and how to keep one change. */
interface ThesisSource {
    all: Thesis[];
    hydrated: boolean;
    /** The stored theses couldn't be loaded. */
    failed: boolean;
    save(thesis: Thesis): void;
    remove(thesis: Thesis): void;
}

/**
 * React hook that backs the research workspace: theses in the user's
 * account when the app has a database (launch item i38), otherwise in this
 * browser. Both start from the example theses, dated from the server's
 * request time, so the server render and hydration agree.
 */
export function useThesisStore() {
    const requestTime = useRequestTime();
    const examples = useMemo(() => getDefaultTheses(requestTime), [requestTime]);
    const inAccount = useAccountStorage();
    const identity = useViewerIdentity();
    const browser = useBrowserTheses(!inAccount, examples);
    const account = useAccountTheses(inAccount, storageScopeFor(identity?.id), examples);
    const { all, hydrated, failed, save, remove: removeThesis } = inAccount ? account : browser;

    // In the account, changes wait for the stored theses: one made to the
    // examples shown while they load would replace the user's saved thesis.
    const ready = !inAccount || hydrated;
    const refuse = useCallback(() => {
        toast(failed
            ? "Your theses couldn't be loaded, so changes can't be saved. Reload to try again."
            : 'Your theses are still loading. Try again in a moment.', { id: 'theses-not-ready' });
        return false;
    }, [failed]);

    /** Changes the thesis `id` with `change`; false when nothing changed (not loaded, or no such thesis). */
    const change = useCallback(
        (id: string, apply: (list: readonly Thesis[]) => Thesis[]): boolean => {
            if (!ready) return refuse();
            const thesis = apply(all).find((t) => t.id === id);
            if (thesis) save(thesis);
            return Boolean(thesis);
        },
        [all, ready, refuse, save],
    );

    /**
     * Creates a thesis and returns its id at once, so the caller can link
     * other records (order rationale, tags, notes) to it in the same tick.
     * Null when it couldn't be made (the theses haven't loaded yet).
     */
    const create = useCallback(
        (draft: ThesisDraft): string | null => {
            if (!ready) {
                refuse();
                return null;
            }
            const thesis = createThesis(draft);
            save(thesis);
            return thesis.id;
        },
        [ready, refuse, save],
    );

    const update = useCallback((id: string, patch: Partial<ThesisDraft>) => change(id, (list) => updateThesis(list, id, patch)), [change]);
    const archive = useCallback((id: string) => change(id, (list) => archiveThesis(list, id)), [change]);
    const restore = useCallback((id: string) => change(id, (list) => restoreThesis(list, id)), [change]);
    /** False, with a message, when the thesis already has as many as the account keeps. */
    const atLimit = useCallback(
        (thesisId: string, kind: 'catalysts' | 'linkedEvidence') => {
            const thesis = all.find((t) => t.id === thesisId);
            const message = thesis ? childLimitMessage(thesis, kind) : null;
            if (message) toast.error(message);
            return message !== null;
        },
        [all],
    );
    const addCatalystTo = useCallback(
        (thesisId: string, catalyst: Omit<ThesisCatalyst, 'id'>) =>
            !atLimit(thesisId, 'catalysts') && change(thesisId, (list) => addCatalyst(list, thesisId, catalyst)),
        [atLimit, change],
    );
    const addEvidenceTo = useCallback(
        (thesisId: string, evidence: Omit<ThesisEvidence, 'id'>) =>
            !atLimit(thesisId, 'linkedEvidence') && change(thesisId, (list) => addEvidence(list, thesisId, evidence)),
        [atLimit, change],
    );

    const remove = useCallback(
        (id: string): boolean => {
            if (!ready) return refuse();
            const thesis = all.find((t) => t.id === id);
            if (thesis) removeThesis(thesis);
            return Boolean(thesis);
        },
        [all, ready, refuse, removeThesis],
    );

    const findByTicker = useCallback((ticker: string) => findThesisByTicker(all, ticker), [all]);

    const { active, archived } = useMemo(() => partitionTheses(all), [all]);

    return {
        theses: all,
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

/** The theses in localStorage, for this browser only. */
function useBrowserTheses(enabled: boolean, examples: Thesis[]): ThesisSource {
    const [theses, setTheses] = useState<Thesis[]>(examples);
    const [hydrated, setHydrated] = useState(false);

    // Hydrate from localStorage on mount so SSR + initial render match.
    useEffect(() => {
        if (!enabled) return;
        const stored = loadThesesFromStorage(getBrowserStorage());
        if (stored && stored.length > 0) {
            // Hydrate client-only thesis state from localStorage.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setTheses(stored);
        }
        setHydrated(true);
    }, [enabled]);

    // Persist any change after hydration — skipping the initial paint avoids
    // clobbering storage with the seed list before we've read from it.
    useEffect(() => {
        if (!enabled || !hydrated) return;
        saveThesesToStorage(getBrowserStorage(), theses);
    }, [enabled, hydrated, theses]);

    const save = useCallback((thesis: Thesis) => {
        setTheses((prev) => (prev.some((t) => t.id === thesis.id)
            ? prev.map((t) => (t.id === thesis.id ? thesis : t))
            : [thesis, ...prev]));
    }, []);

    const remove = useCallback((thesis: Thesis) => {
        setTheses((prev) => deleteThesis(prev, thesis.id));
    }, []);

    return { all: theses, hydrated, failed: false, save, remove };
}

function saveFailedMessage(write: ThesisWrite): string {
    const action = write.thesis.dismissed ? 'delete' : 'save';
    return `Couldn't ${action} your ${write.thesis.ticker} thesis. Try again.`;
}

/**
 * The theses in the user's account, with this page's unsaved writes on
 * top. The first load sends what this browser kept before, once.
 */
function useAccountTheses(enabled: boolean, scope: string, examples: Thesis[]): ThesisSource {
    const { data, pending, write, loaded, failed } = useAccountRecords<AccountTheses, ThesisWrite>({
        queryKey: ACCOUNT_QUERY,
        enabled,
        load: async () => {
            try {
                await importBrowserTheses(scope, {
                    storage: getBrowserStorage(),
                    examples,
                    now: Date.now(),
                    onShortened: () => toast(
                        'Some theses had more text than your account keeps and were shortened. This browser keeps the full text.',
                        { duration: 15_000 },
                    ),
                });
            } catch (error) {
                // Kept in this browser and sent again next time.
                console.warn('[theses] import from this browser failed', error);
            }
            return fetchAccountTheses();
        },
        send: (id, w, order) => sendThesisWrite(id, w, order),
        apply: applyThesisWrite,
        failedMessage: saveFailedMessage,
        loadFailedMessage: "Couldn't load your theses. Showing examples only.",
    });

    const all = useMemo(
        () => (enabled ? mergeAccountTheses(data, pending, examples) : examples),
        [enabled, data, pending, examples],
    );

    const save = useCallback(
        (thesis: Thesis) => {
            const input = toThesisInput(thesis, { now: Date.now() });
            if (input) write(thesis.id, { kind: 'put', thesis: input });
        },
        [write],
    );

    const remove = useCallback(
        (thesis: Thesis) => {
            // Saved as dismissed: an example isn't shown again, and the
            // user's own can't be brought back by a save that lands late.
            const input = toThesisInput(thesis, { now: Date.now(), dismissed: true });
            if (input) write(thesis.id, { kind: 'put', thesis: input });
        },
        [write],
    );

    return { all, hydrated: loaded, failed, save, remove };
}
