'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBrowserStorage } from './storage';
import {
    addToWatchlist,
    findWatchItem,
    loadWatchlist,
    removeFromWatchlist,
    saveWatchlist,
    seedWatchlist,
    updateWatchItem,
    WATCHLIST_STORAGE_KEY,
    type AddWatchError,
    type WatchItem,
} from './watchlist';

const SYNC_EVENT = 'atlas:watchlist-changed';
const DAY_MS = 86_400_000;

/**
 * The user's watchlist, persisted to localStorage. Server render and first
 * client paint use the example seed (dated to the UTC day, so they agree);
 * the stored list replaces it after mount. Every mounted instance — Research,
 * position detail, Today — stays in sync through a window event, and other
 * tabs through the `storage` event.
 */
export function useWatchlist() {
    const [items, setItems] = useState<WatchItem[]>(() => seedWatchlist(Math.floor(Date.now() / DAY_MS) * DAY_MS));
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        const read = () => {
            const stored = loadWatchlist(getBrowserStorage());
            if (stored) setItems(stored);
        };
        read();
        // Client-only state: localStorage is unavailable during the server render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHydrated(true);
        const onStorage = (e: StorageEvent) => {
            if (e.key === WATCHLIST_STORAGE_KEY) read();
        };
        window.addEventListener(SYNC_EVENT, read);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(SYNC_EVENT, read);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const commit = useCallback((next: WatchItem[]) => {
        setItems(next);
        saveWatchlist(getBrowserStorage(), next);
        window.dispatchEvent(new Event(SYNC_EVENT));
    }, []);

    const add = useCallback(
        (ticker: string, companyName?: string): { item?: WatchItem; error?: AddWatchError } => {
            const result = addToWatchlist(items, ticker, { now: Date.now(), companyName });
            if (!result.error) commit(result.list);
            return { item: result.item, error: result.error };
        },
        [items, commit],
    );

    const remove = useCallback((ticker: string) => commit(removeFromWatchlist(items, ticker)), [items, commit]);

    const update = useCallback(
        (id: string, patch: Parameters<typeof updateWatchItem>[2]) => commit(updateWatchItem(items, id, patch)),
        [items, commit],
    );

    const isWatched = useCallback((ticker: string) => Boolean(findWatchItem(items, ticker)), [items]);

    return { items, hydrated, add, remove, update, isWatched };
}
