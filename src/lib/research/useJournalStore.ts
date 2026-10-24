'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAccountStorage, useViewerIdentity } from '@/components/providers/IdentityProvider';
import { storageScopeFor } from '@/lib/storage/user-scope';
import {
    createJournalEntry,
    DEFAULT_JOURNAL_ENTRIES,
    deleteJournalEntry,
    sortJournalEntries,
    updateJournalEntry,
    type JournalDraft,
    type JournalEntry,
} from './journal';
import {
    applyJournalWrite,
    fetchAccountJournal,
    importBrowserJournal,
    mergeAccountJournal,
    sendJournalWrite,
    toJournalEntryInput,
    type AccountJournal,
    type JournalWrite,
} from './journalAccount';
import { getBrowserStorage } from './storage';
import { loadJournalFromStorage, saveJournalToStorage } from './journalStorage';
import { useAccountRecords } from './useAccountRecords';

const ACCOUNT_QUERY = ['research', 'journal'] as const;

/** Where the journal lives: how to read it and how to keep one change. */
interface JournalSource {
    all: JournalEntry[];
    hydrated: boolean;
    /** The stored journal couldn't be loaded. */
    failed: boolean;
    save(entry: JournalEntry): void;
    remove(entry: JournalEntry): void;
}

/**
 * React hook backing the decision journal: in the user's account when the
 * app has a database (launch item i38), otherwise in this browser. Both
 * start from the example entries, so the server render and first paint
 * agree.
 */
export function useJournalStore() {
    const inAccount = useAccountStorage();
    const identity = useViewerIdentity();
    const browser = useBrowserJournal(!inAccount);
    const account = useAccountJournal(inAccount, storageScopeFor(identity?.id));
    const { all, hydrated, failed, save, remove: removeEntry } = inAccount ? account : browser;
    // In the account, changes wait for the stored journal: one made to the
    // examples shown while it loads would replace the user's saved entry.
    const ready = !inAccount || hydrated;
    const refuse = useCallback(() => {
        toast(failed
            ? "Your journal couldn't be loaded, so changes can't be saved. Reload to try again."
            : 'Your journal is still loading. Try again in a moment.', { id: 'journal-not-ready' });
        return false;
    }, [failed]);

    /** Each change returns false when it wasn't made (the journal hasn't loaded). */
    const create = useCallback((draft: JournalDraft): boolean => {
        if (!ready) return refuse();
        save(createJournalEntry(draft));
        return true;
    }, [ready, refuse, save]);

    const update = useCallback(
        (id: string, patch: Partial<JournalDraft>): boolean => {
            if (!ready) return refuse();
            const entry = updateJournalEntry(all, id, patch).find((e) => e.id === id);
            if (entry) save(entry);
            return Boolean(entry);
        },
        [all, ready, refuse, save],
    );

    const remove = useCallback(
        (id: string): boolean => {
            if (!ready) return refuse();
            const entry = all.find((e) => e.id === id);
            if (entry) removeEntry(entry);
            return Boolean(entry);
        },
        [all, ready, refuse, removeEntry],
    );

    const sorted = useMemo(() => sortJournalEntries(all), [all]);

    return { entries: sorted, hydrated, create, update, remove };
}

/** The journal in localStorage, for this browser only. */
function useBrowserJournal(enabled: boolean): JournalSource {
    const [entries, setEntries] = useState<JournalEntry[]>(DEFAULT_JOURNAL_ENTRIES);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        const stored = loadJournalFromStorage(getBrowserStorage());
        if (stored && stored.length > 0) {
            // Hydrate client-only journal state from localStorage.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setEntries(stored);
        }
        setHydrated(true);
    }, [enabled]);

    useEffect(() => {
        if (!enabled || !hydrated) return;
        saveJournalToStorage(getBrowserStorage(), entries);
    }, [enabled, hydrated, entries]);

    const save = useCallback((entry: JournalEntry) => {
        setEntries((prev) => (prev.some((e) => e.id === entry.id)
            ? prev.map((e) => (e.id === entry.id ? entry : e))
            : [entry, ...prev]));
    }, []);

    const remove = useCallback((entry: JournalEntry) => {
        setEntries((prev) => deleteJournalEntry(prev, entry.id));
    }, []);

    return { all: entries, hydrated, failed: false, save, remove };
}

function saveFailedMessage(write: JournalWrite): string {
    const ticker = write.entry.ticker;
    const action = write.entry.dismissed ? 'delete' : 'save';
    return `Couldn't ${action} the journal entry for ${ticker}. Try again.`;
}

/**
 * The journal in the user's account, with this page's unsaved writes on
 * top. The first load sends what this browser kept before, once.
 */
function useAccountJournal(enabled: boolean, scope: string): JournalSource {
    const { data, pending, write, loaded, failed } = useAccountRecords<AccountJournal, JournalWrite>({
        queryKey: ACCOUNT_QUERY,
        enabled,
        load: async () => {
            try {
                await importBrowserJournal(scope, {
                    storage: getBrowserStorage(),
                    examples: DEFAULT_JOURNAL_ENTRIES,
                    now: Date.now(),
                    onShortened: () => toast(
                        'Some journal entries were longer than your account keeps (500 characters for the decision, 5,000 for the rationale) and were shortened. This browser keeps the full text.',
                        { duration: 15_000 },
                    ),
                });
            } catch (error) {
                // Kept in this browser and sent again next time.
                console.warn('[journal] import from this browser failed', error);
            }
            return fetchAccountJournal();
        },
        send: (id, w, order) => sendJournalWrite(id, w, order),
        apply: applyJournalWrite,
        failedMessage: saveFailedMessage,
        loadFailedMessage: "Couldn't load your journal. Showing examples only.",
    });

    const all = useMemo(
        () => (enabled ? mergeAccountJournal(data, pending, DEFAULT_JOURNAL_ENTRIES) : DEFAULT_JOURNAL_ENTRIES),
        [enabled, data, pending],
    );

    const save = useCallback(
        (entry: JournalEntry) => {
            const input = toJournalEntryInput(entry, { now: Date.now() });
            if (input) write(entry.id, { kind: 'put', entry: input });
        },
        [write],
    );

    const remove = useCallback(
        (entry: JournalEntry) => {
            // Saved as dismissed: an example isn't shown again, and the
            // user's own can't be brought back by a save that lands late.
            const input = toJournalEntryInput(entry, { now: Date.now(), dismissed: true });
            if (input) write(entry.id, { kind: 'put', entry: input });
        },
        [write],
    );

    return { all, hydrated: loaded, failed, save, remove };
}
