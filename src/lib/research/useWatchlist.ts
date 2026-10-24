'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAccountStorage, useViewerIdentity } from '@/components/providers/IdentityProvider';
import { useRequestTime } from '@/components/providers/RequestTimeProvider';
import { useShowSampleData } from '@/lib/hooks/useShowSampleData';
import { getBrowserStorage } from './storage';
import {
    addToWatchlist,
    findWatchItem,
    loadWatchlist,
    removeFromWatchlist,
    saveWatchlist,
    seedWatchlist,
    updateWatchItem,
    visibleWatchItems,
    watchlistStorageKey,
    type AddWatchError,
    type WatchItem,
} from './watchlist';
import { AccountRequestError } from './accountWrites';
import { useAccountRecords } from './useAccountRecords';
import {
    applyWatchWrite,
    fetchAccountWatchlist,
    importBrowserWatchlist,
    mergeAccountWatchlist,
    saveWrite,
    sendWatchWrite,
    toWatchItemInput,
    type AccountWatchlist,
    type WatchWrite,
} from './watchlistAccount';

const SYNC_EVENT = 'atlas:watchlist-changed';
const DAY_MS = 86_400_000;
// One user per page load (signing in or out reloads), so one key.
const ACCOUNT_QUERY = ['research', 'watchlist'] as const;

interface SyncDetail {
    key: string;
    items: WatchItem[];
}

/** Where the list lives: how to read it and how to keep one change. */
interface WatchlistSource {
    all: WatchItem[];
    hydrated: boolean;
    /** The stored list couldn't be loaded. */
    failed: boolean;
    save(next: WatchItem[], item: WatchItem): void;
    remove(next: WatchItem[], item: WatchItem): void;
}

/**
 * The signed-in user's watchlist: in their account when the app has a
 * database (launch item i38), otherwise in this browser under a per-user
 * key. Server render and first client paint show the example rows (dated to
 * the request's UTC day, so they agree); the stored list replaces them once
 * it has loaded. Example rows are hidden when the user turns example data
 * off.
 */
export function useWatchlist() {
    const identity = useViewerIdentity();
    const inAccount = useAccountStorage();
    const key = watchlistStorageKey(identity?.id);
    const showSample = useShowSampleData();
    const requestTime = useRequestTime();
    const examples = useMemo(() => seedWatchlist(Math.floor(requestTime / DAY_MS) * DAY_MS), [requestTime]);

    const browser = useBrowserWatchlist(!inAccount, key, examples);
    const account = useAccountWatchlist(inAccount, key, examples);
    const { all, hydrated, failed, save, remove: removeItem } = inAccount ? account : browser;
    // In the account, changes wait for the stored list: one made to the
    // examples shown while it loads would replace the user's saved row.
    const ready = !inAccount || hydrated;
    const notReadyMessage = failed
        ? "Your watchlist couldn't be loaded, so changes can't be saved. Reload to try again."
        : 'Your watchlist is still loading. Try again in a moment.';

    const add = useCallback(
        (ticker: string, companyName?: string): { item?: WatchItem; error?: AddWatchError; message?: string } => {
            if (!ready) {
                toast(notReadyMessage, { id: 'watchlist-not-ready' });
                return { error: 'not-ready', message: notReadyMessage };
            }
            const result = addToWatchlist(all, ticker, { now: Date.now(), companyName });
            if (result.item) save(result.list, result.item);
            return { item: result.item, error: result.error };
        },
        [all, notReadyMessage, ready, save],
    );

    /** False when nothing was removed (the list hasn't loaded, or the ticker isn't on it). */
    const remove = useCallback(
        (ticker: string): boolean => {
            if (!ready) {
                toast(notReadyMessage, { id: 'watchlist-not-ready' });
                return false;
            }
            const item = findWatchItem(all, ticker);
            if (item) removeItem(removeFromWatchlist(all, ticker), item);
            return Boolean(item);
        },
        [all, notReadyMessage, ready, removeItem],
    );

    const update = useCallback(
        (id: string, patch: Parameters<typeof updateWatchItem>[2]) => {
            if (!ready) {
                toast(notReadyMessage, { id: 'watchlist-not-ready' });
                return;
            }
            const next = updateWatchItem(all, id, patch);
            const item = next.find((w) => w.id === id);
            if (item) save(next, item);
        },
        [all, notReadyMessage, ready, save],
    );

    const items = useMemo(() => visibleWatchItems(all, showSample), [all, showSample]);
    const isWatched = useCallback((ticker: string) => Boolean(findWatchItem(items, ticker)), [items]);

    return { items, hydrated, add, remove, update, isWatched };
}

/**
 * The list in localStorage. Mounted instances (Research, position detail,
 * Today) sync from the change event's payload rather than re-reading
 * storage, so an edit still shows when the write fails (quota); other tabs
 * sync through the `storage` event.
 */
function useBrowserWatchlist(enabled: boolean, key: string, examples: WatchItem[]): WatchlistSource {
    const [stored, setStored] = useState<WatchItem[] | null>(null);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        const initial = loadWatchlist(getBrowserStorage(), key);
        // Client-only state: localStorage is unavailable during the server render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (initial) setStored(initial);
        setHydrated(true);
        const onSync = (e: Event) => {
            const detail = (e as CustomEvent<SyncDetail>).detail;
            if (detail?.key === key) setStored(detail.items);
        };
        const onStorage = (e: StorageEvent) => {
            if (e.key !== key) return;
            const next = loadWatchlist(getBrowserStorage(), key);
            if (next) setStored(next);
        };
        window.addEventListener(SYNC_EVENT, onSync);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(SYNC_EVENT, onSync);
            window.removeEventListener('storage', onStorage);
        };
    }, [enabled, key]);

    const commit = useCallback(
        (next: WatchItem[]) => {
            setStored(next);
            saveWatchlist(getBrowserStorage(), next, key);
            window.dispatchEvent(new CustomEvent<SyncDetail>(SYNC_EVENT, { detail: { key, items: next } }));
        },
        [key],
    );

    return { all: stored ?? examples, hydrated, failed: false, save: commit, remove: commit };
}

function saveFailedMessage(write: WatchWrite, error: unknown): string {
    const ticker = write.item.ticker;
    if (error instanceof AccountRequestError && error.code === 'DUPLICATE_TICKER') {
        return `${ticker} is already on your watchlist.`;
    }
    const action = write.item.dismissed ? 'remove' : 'save';
    return `Couldn't ${action} ${ticker} on your watchlist. Try again.`;
}

/**
 * The list in the user's account, with this page's unsaved writes on top.
 * The first load sends what this browser kept before, once.
 */
function useAccountWatchlist(enabled: boolean, key: string, examples: WatchItem[]): WatchlistSource {
    const { data, pending, write, loaded, failed } = useAccountRecords<AccountWatchlist, WatchWrite>({
        queryKey: ACCOUNT_QUERY,
        enabled,
        load: async () => {
            try {
                await importBrowserWatchlist(key, {
                    storage: getBrowserStorage(),
                    examples,
                    now: Date.now(),
                    onShortened: () => toast(
                        'Some watchlist notes were longer than your account keeps (500 characters for why, 5,000 for notes) and were shortened. This browser keeps the full text.',
                        { duration: 15_000 },
                    ),
                });
            } catch (error) {
                // Kept in this browser and sent again next time.
                console.warn('[watchlist] import from this browser failed', error);
            }
            return fetchAccountWatchlist();
        },
        send: (id, w, order) => sendWatchWrite(id, w, order),
        apply: applyWatchWrite,
        failedMessage: saveFailedMessage,
        loadFailedMessage: "Couldn't load your watchlist. Showing examples only.",
    });

    const all = useMemo(
        () => (enabled ? mergeAccountWatchlist(data, pending, examples) : examples),
        [enabled, data, pending, examples],
    );

    const save = useCallback(
        (_next: WatchItem[], item: WatchItem) => {
            const input = toWatchItemInput(item, { now: Date.now() });
            if (!input) return;
            const save = saveWrite(input, pending);
            write(save.id, save.write);
        },
        [pending, write],
    );

    const remove = useCallback(
        (_next: WatchItem[], item: WatchItem) => {
            // Saved as dismissed: an example isn't shown again, and the
            // user's own can't be brought back by a save that lands late.
            const input = toWatchItemInput(item, { now: Date.now(), dismissed: true });
            if (input) write(item.id, { kind: 'put', item: input });
        },
        [write],
    );

    return { all, hydrated: loaded, failed, save, remove };
}
