import {
    WATCH_ITEM_LIMITS,
    WATCHLIST_IMPORT_MAX_ITEMS,
    watchItemSchema,
    type WatchItemInput,
    type WatchWriteOrder,
} from '@/lib/validators/watchlist';

import { accountRequest, importInBatches, importOnce, sendRecordWrite, type Fetch } from './accountWrites';
import type { StoredWatchlist } from './server/watchlist';
import { WATCHLIST_STORAGE_KEY, isExampleWatchId, isoDay, loadWatchlist, type WatchItem } from './watchlist';

/**
 * The watchlist in the user's account (launch item i38), for `useWatchlist`
 * when the app has a database.
 *
 * - The list shown is the account's rows, with this page's unsaved writes
 *   on top, then the example rows the user hasn't adopted or removed. A
 *   removed item is saved as `dismissed`, so a removed example stays gone
 *   and a late save can't bring the user's own back.
 * - Writes show at once and are sent one at a time per item, latest wins; a
 *   write that fails is undone and the list is read again. Each carries this
 *   page's session and its count of writes, so the server keeps the newest
 *   even if two arrive out of order (a page closing with one in flight).
 * - A list this browser kept before (under the user's localStorage key) is
 *   sent once, then removed from the browser.
 */

export type AccountWatchlist = StoredWatchlist;

/** One save. Removing an item saves it with `dismissed: true`. */
export type WatchWrite = { kind: 'put'; item: WatchItemInput };

function toWatchItem(input: WatchItemInput): WatchItem {
    return {
        id: input.id,
        ticker: input.ticker,
        companyName: input.companyName,
        reason: input.reason,
        notes: input.notes,
        targetEntry: input.targetEntry,
        addedAt: input.addedAt,
    };
}

/** The list to show: account rows, then pending writes, then examples. */
export function mergeAccountWatchlist(
    stored: AccountWatchlist | undefined,
    pending: ReadonlyMap<string, WatchWrite>,
    examples: readonly WatchItem[],
): WatchItem[] {
    const rows = new Map<string, WatchItemInput>();
    for (const item of stored?.items ?? []) rows.set(item.id, item);
    const dismissed = new Set(stored?.dismissed ?? []);
    const added: WatchItemInput[] = [];
    for (const [id, write] of pending) {
        if (write.item.dismissed) {
            rows.delete(id);
            dismissed.add(id);
            continue;
        }
        dismissed.delete(id);
        if (rows.has(id)) rows.set(id, write.item);
        else added.unshift(write.item);
    }

    const own = [...added, ...rows.values()].map(toWatchItem);
    const byId = new Map(own.map((w) => [w.id, w]));
    const tickers = new Set(own.map((w) => w.ticker));
    // Examples stay at the end in their own order, as they do in the browser.
    const shownExamples = examples.flatMap((example) => {
        const saved = byId.get(example.id);
        if (saved) return [saved];
        return dismissed.has(example.id) || tickers.has(example.ticker) ? [] : [example];
    });
    return [...own.filter((w) => !isExampleWatchId(w.id)), ...shownExamples];
}

/**
 * The write for saving `item`. Re-adding a ticker whose removal hasn't been
 * saved yet reuses the removed row's ID, so the add queues behind the
 * removal (and replaces it) rather than racing it: sent separately, an add
 * that landed first would collide with the row still live under its ticker.
 */
export function saveWrite(item: WatchItemInput, pending: ReadonlyMap<string, WatchWrite>): { id: string; write: WatchWrite } {
    if (!item.dismissed) {
        for (const [id, write] of pending) {
            if (id !== item.id && write.item.dismissed && write.item.ticker === item.ticker) {
                return { id, write: { kind: 'put', item: { ...item, id } } };
            }
        }
    }
    return { id: item.id, write: { kind: 'put', item } };
}

/** The account's list once `write` is saved. */
export function applyWatchWrite(stored: AccountWatchlist | undefined, id: string, write: WatchWrite): AccountWatchlist {
    const items = (stored?.items ?? []).filter((item) => item.id !== id);
    const dismissed = (stored?.dismissed ?? []).filter((d) => d !== id);
    if (write.item.dismissed) return { items, dismissed: [...dismissed, id] };
    const index = stored?.items.findIndex((item) => item.id === id) ?? -1;
    if (index < 0) return { items: [write.item, ...items], dismissed };
    items.splice(index, 0, write.item);
    return { items, dismissed };
}

/**
 * `item` as the API takes it: no example flag, text cut to the limits, a
 * missing date made today. Null for an item the API would refuse anyway.
 */
export function toWatchItemInput(item: WatchItem, { now, dismissed = false }: { now: number; dismissed?: boolean }): WatchItemInput | null {
    const parsed = watchItemSchema.safeParse({
        id: item.id,
        ticker: item.ticker,
        companyName: item.companyName.trim().slice(0, WATCH_ITEM_LIMITS.companyName),
        reason: item.reason.trim().slice(0, WATCH_ITEM_LIMITS.reason),
        notes: item.notes.slice(0, WATCH_ITEM_LIMITS.notes),
        targetEntry: item.targetEntry,
        addedAt: /^\d{4}-\d{2}-\d{2}$/.test(item.addedAt) ? item.addedAt : isoDay(now),
        dismissed,
    });
    return parsed.success ? parsed.data : null;
}

/**
 * What to send from a list this browser kept: the user's own rows (adopted
 * examples included) and a dismissal for each example they removed.
 * Untouched examples need nothing.
 */
export function watchlistImportItems(
    local: readonly WatchItem[],
    examples: readonly WatchItem[],
    now: number,
): { items: WatchItemInput[]; shortened: boolean } {
    const ids = new Set(local.map((w) => w.id));
    const seen = new Set<string>();
    let shortened = false;
    const own = local.flatMap((item) => {
        if (item.sample || seen.has(item.id)) return [];
        seen.add(item.id);
        const input = toWatchItemInput(item, { now });
        // Text the browser allowed but the account doesn't (or a row it can't store at all).
        if (!input || input.reason.length < item.reason.trim().length || input.notes.length < item.notes.length
            || input.companyName.length < item.companyName.trim().length) {
            shortened = true;
        }
        return input ? [input] : [];
    });
    const removed = examples.flatMap((example) => {
        if (ids.has(example.id)) return [];
        const input = toWatchItemInput(example, { now, dismissed: true });
        return input ? [input] : [];
    });
    return { items: [...own, ...removed], shortened };
}

/** Where this browser keeps its full list when the account couldn't take all of its text. */
export function watchlistFullCopyKey(key: string): string {
    return `${WATCHLIST_STORAGE_KEY}-full-copy${key.slice(WATCHLIST_STORAGE_KEY.length)}`;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export async function fetchAccountWatchlist(fetchImpl: Fetch = fetch): Promise<AccountWatchlist> {
    const response = await accountRequest(fetchImpl, '/api/research/watchlist');
    const body = (await response.json()) as { data?: Partial<AccountWatchlist> };
    return {
        items: Array.isArray(body.data?.items) ? body.data.items : [],
        dismissed: Array.isArray(body.data?.dismissed) ? body.data.dismissed : [],
    };
}

export async function sendWatchWrite(id: string, write: WatchWrite, order: WatchWriteOrder, fetchImpl: Fetch = fetch): Promise<void> {
    await sendRecordWrite(fetchImpl, `/api/research/watchlist/${encodeURIComponent(id)}`,
        { kind: 'put', body: { item: write.item } }, order);
}

/** Sends `items` in batches that the server orders as one list. */
export async function importAccountWatchlist(
    items: readonly WatchItemInput[],
    fetchImpl: Fetch = fetch,
    startedAt: number = Date.now(),
): Promise<void> {
    await importInBatches(fetchImpl, '/api/research/watchlist/import', items, WATCHLIST_IMPORT_MAX_ITEMS, startedAt);
}

/**
 * Sends the list this browser kept under `key` to the account, once per page
 * load, then removes the browser's copy. A failed send keeps the copy, and
 * the next call tries again. Safe to repeat: the account keeps rows it
 * already has.
 */
export function importBrowserWatchlist(
    key: string,
    {
        storage,
        examples,
        now,
        fetchImpl = fetch,
        onShortened,
    }: {
        storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
        examples: readonly WatchItem[];
        now: number;
        fetchImpl?: Fetch;
        /** Called once when some text was longer than the account keeps. */
        onShortened?: () => void;
    },
): Promise<void> {
    return importOnce(key, async () => {
        const local = loadWatchlist(storage, key);
        if (!local) return;
        const { items, shortened } = watchlistImportItems(local, examples, now);
        await importAccountWatchlist(items, fetchImpl);
        try {
            // Text the account couldn't take stays in this browser, under a
            // key of its own, rather than being lost.
            if (shortened) storage?.setItem(watchlistFullCopyKey(key), storage.getItem(key) ?? '');
            storage?.removeItem(key);
        } catch {
            // Sent again next time (the account keeps what it has), and the
            // full list stays where it was.
        }
        if (shortened) onShortened?.();
    });
}
