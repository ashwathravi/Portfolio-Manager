'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useViewerIdentity } from '@/components/providers/IdentityProvider';
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

const SYNC_EVENT = 'atlas:watchlist-changed';
const DAY_MS = 86_400_000;

interface SyncDetail {
    key: string;
    items: WatchItem[];
}

/**
 * The signed-in user's watchlist, persisted to localStorage under a per-user
 * key. Server render and first client paint use the example seed (dated to
 * the UTC day, so they agree); the stored list replaces it after mount.
 *
 * Mounted instances (Research, position detail, Today) sync from the change
 * event's payload rather than re-reading storage, so an edit still shows when
 * the write fails (quota); other tabs sync through the `storage` event.
 * Example rows are hidden when the user turns example data off.
 */
export function useWatchlist() {
    const identity = useViewerIdentity();
    const key = watchlistStorageKey(identity?.id);
    const showSample = useShowSampleData();
    const [all, setAll] = useState<WatchItem[]>(() => seedWatchlist(Math.floor(Date.now() / DAY_MS) * DAY_MS));
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        const stored = loadWatchlist(getBrowserStorage(), key);
        // Client-only state: localStorage is unavailable during the server render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (stored) setAll(stored);
        setHydrated(true);
        const onSync = (e: Event) => {
            const detail = (e as CustomEvent<SyncDetail>).detail;
            if (detail?.key === key) setAll(detail.items);
        };
        const onStorage = (e: StorageEvent) => {
            if (e.key !== key) return;
            const next = loadWatchlist(getBrowserStorage(), key);
            if (next) setAll(next);
        };
        window.addEventListener(SYNC_EVENT, onSync);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(SYNC_EVENT, onSync);
            window.removeEventListener('storage', onStorage);
        };
    }, [key]);

    const commit = useCallback(
        (next: WatchItem[]) => {
            setAll(next);
            saveWatchlist(getBrowserStorage(), next, key);
            window.dispatchEvent(new CustomEvent<SyncDetail>(SYNC_EVENT, { detail: { key, items: next } }));
        },
        [key],
    );

    const add = useCallback(
        (ticker: string, companyName?: string): { item?: WatchItem; error?: AddWatchError } => {
            const result = addToWatchlist(all, ticker, { now: Date.now(), companyName });
            if (!result.error) commit(result.list);
            return { item: result.item, error: result.error };
        },
        [all, commit],
    );

    const remove = useCallback((ticker: string) => commit(removeFromWatchlist(all, ticker)), [all, commit]);

    const update = useCallback(
        (id: string, patch: Parameters<typeof updateWatchItem>[2]) => commit(updateWatchItem(all, id, patch)),
        [all, commit],
    );

    const items = useMemo(() => visibleWatchItems(all, showSample), [all, showSample]);
    const isWatched = useCallback((ticker: string) => Boolean(findWatchItem(items, ticker)), [items]);

    return { items, hydrated, add, remove, update, isWatched };
}
