import {
    WATCH_ITEM_LIMITS,
    WATCHLIST_IMPORT_MAX_ITEMS,
    watchItemSchema,
    type WatchItemInput,
} from '@/lib/validators/watchlist';

import type { StoredWatchlist } from './server/watchlist';
import { isExampleWatchId, isoDay, loadWatchlist, type WatchItem } from './watchlist';

/**
 * The watchlist in the user's account (launch item i38), for `useWatchlist`
 * when the app has a database.
 *
 * - The list shown is the account's rows, with this page's unsaved writes
 *   on top, then the example rows the user hasn't adopted or removed. A
 *   removed example is saved as `dismissed`, so it stays gone.
 * - Writes show at once and are sent one at a time per item, latest wins; a
 *   write that fails is undone and the list is read again.
 * - A list this browser kept before (under the user's localStorage key) is
 *   sent once, then removed from the browser.
 */

export type AccountWatchlist = StoredWatchlist;

export type WatchWrite = { kind: 'put'; item: WatchItemInput } | { kind: 'delete'; ticker: string };

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
        if (write.kind === 'delete' || write.item.dismissed) {
            rows.delete(id);
            if (write.kind === 'put') dismissed.add(id);
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

/** The account's list once `write` is saved. */
export function applyWatchWrite(stored: AccountWatchlist | undefined, id: string, write: WatchWrite): AccountWatchlist {
    const items = (stored?.items ?? []).filter((item) => item.id !== id);
    const dismissed = (stored?.dismissed ?? []).filter((d) => d !== id);
    if (write.kind === 'delete') return { items, dismissed };
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
export function watchlistImportItems(local: readonly WatchItem[], examples: readonly WatchItem[], now: number): WatchItemInput[] {
    const ids = new Set(local.map((w) => w.id));
    const seen = new Set<string>();
    const own = local.flatMap((item) => {
        if (item.sample || seen.has(item.id)) return [];
        seen.add(item.id);
        const input = toWatchItemInput(item, { now });
        return input ? [input] : [];
    });
    const removed = examples.flatMap((example) => {
        if (ids.has(example.id)) return [];
        const input = toWatchItemInput(example, { now, dismissed: true });
        return input ? [input] : [];
    });
    return [...own, ...removed];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface WatchlistWriter {
    /** Writes not yet saved, by item ID. A new map after every change. */
    pending(): ReadonlyMap<string, WatchWrite>;
    write(id: string, write: WatchWrite): void;
    /** For a page that is closing: sends the writes still waiting behind one in flight, now. */
    sendWaiting(): void;
    subscribe(listener: () => void): () => void;
}

/**
 * Sends each item's writes one at a time; a write made while one is in
 * flight replaces any still waiting, so only the latest is sent next.
 */
export function createWatchlistWriter({
    send,
    onSaved,
    onFailed,
}: {
    send: (id: string, write: WatchWrite) => Promise<void>;
    onSaved: (id: string, write: WatchWrite) => void;
    onFailed: (id: string, write: WatchWrite, error: unknown) => void;
}): WatchlistWriter {
    const pending = new Map<string, WatchWrite>();
    const sending = new Set<string>();
    const listeners = new Set<() => void>();
    let snapshot: ReadonlyMap<string, WatchWrite> = new Map();

    const changed = () => {
        snapshot = new Map(pending);
        for (const listener of listeners) listener();
    };

    const drain = async (id: string) => {
        if (sending.has(id)) return;
        sending.add(id);
        try {
            for (;;) {
                const write = pending.get(id);
                if (!write) return;
                let failure: { error: unknown } | null = null;
                try {
                    await send(id, write);
                } catch (error) {
                    failure = { error };
                }
                // A newer write came in meanwhile: send that one.
                if (pending.get(id) !== write) continue;
                pending.delete(id);
                if (failure) onFailed(id, write, failure.error);
                else onSaved(id, write);
                changed();
                return;
            }
        } finally {
            sending.delete(id);
        }
    };

    return {
        pending: () => snapshot,
        write(id, write) {
            pending.set(id, write);
            changed();
            void drain(id);
        },
        sendWaiting() {
            for (const [id, write] of pending) {
                // Not sending: drain already sent it. If the page stays
                // (back-forward cache), drain sends it again; a repeated
                // save is harmless.
                if (sending.has(id)) void send(id, write).catch(() => {});
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class WatchlistRequestError extends Error {
    constructor(readonly status: number, readonly code: string | null) {
        super(`Watchlist request failed (${status}${code ? ` ${code}` : ''})`);
    }
}

type Fetch = typeof fetch;

async function request(fetchImpl: Fetch, path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetchImpl(path, {
        ...init,
        headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
        throw new WatchlistRequestError(response.status, typeof body?.code === 'string' ? body.code : null);
    }
    return response;
}

export async function fetchAccountWatchlist(fetchImpl: Fetch = fetch): Promise<AccountWatchlist> {
    const response = await request(fetchImpl, '/api/research/watchlist');
    const body = (await response.json()) as { data?: Partial<AccountWatchlist> };
    return {
        items: Array.isArray(body.data?.items) ? body.data.items : [],
        dismissed: Array.isArray(body.data?.dismissed) ? body.data.dismissed : [],
    };
}

/** Saves or deletes one item; keepalive, so a write made just before leaving the page still arrives. */
export async function sendWatchWrite(id: string, write: WatchWrite, fetchImpl: Fetch = fetch): Promise<void> {
    const path = `/api/research/watchlist/${encodeURIComponent(id)}`;
    await request(fetchImpl, path, write.kind === 'delete'
        ? { method: 'DELETE', keepalive: true }
        : { method: 'PUT', body: JSON.stringify(write.item), keepalive: true });
}

// About 600 KiB at most per request, under the route's 1 MiB limit.
const IMPORT_BATCH = Math.min(100, WATCHLIST_IMPORT_MAX_ITEMS);

export async function importAccountWatchlist(items: readonly WatchItemInput[], fetchImpl: Fetch = fetch): Promise<void> {
    for (let start = 0; start < items.length; start += IMPORT_BATCH) {
        await request(fetchImpl, '/api/research/watchlist/import', {
            method: 'POST',
            body: JSON.stringify({ items: items.slice(start, start + IMPORT_BATCH) }),
        });
    }
}

const imports = new Map<string, Promise<void>>();

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
    }: { storage: Pick<Storage, 'getItem' | 'removeItem'> | null; examples: readonly WatchItem[]; now: number; fetchImpl?: Fetch },
): Promise<void> {
    const running = imports.get(key);
    if (running) return running;
    const run = (async () => {
        const local = loadWatchlist(storage, key);
        if (!local) return;
        await importAccountWatchlist(watchlistImportItems(local, examples, now), fetchImpl);
        try {
            storage?.removeItem(key);
        } catch {
            // Sent again next time; the account keeps what it has.
        }
    })();
    imports.set(key, run);
    run.catch(() => imports.delete(key));
    return run;
}
