import {
    WATCH_ITEM_LIMITS,
    WATCHLIST_IMPORT_MAX_ITEMS,
    watchItemSchema,
    type WatchItemInput,
    type WatchWriteOrder,
} from '@/lib/validators/watchlist';

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
// Writes
// ---------------------------------------------------------------------------

export interface WatchlistWriter {
    /** Writes not yet saved, by item ID. A new map after every change. */
    pending(): ReadonlyMap<string, WatchWrite>;
    /** This page's ID, sent with every write. */
    readonly session: string;
    write(id: string, write: WatchWrite): void;
    /** For a page that is closing: sends the writes still waiting behind one in flight, now. */
    sendWaiting(): void;
    /** Resolves once no write is waiting or in flight. */
    idle(): Promise<void>;
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
    session = newWriteSession(),
}: {
    send: (id: string, write: WatchWrite, order: WatchWriteOrder) => Promise<void>;
    onSaved: (id: string, write: WatchWrite) => void;
    onFailed: (id: string, write: WatchWrite, error: unknown) => void;
    session?: string;
}): WatchlistWriter {
    const pending = new Map<string, WatchWrite>();
    // Each write's place in this page's order, numbered as it is made.
    const seqs = new WeakMap<WatchWrite, number>();
    let count = 0;
    const orderOf = (write: WatchWrite): WatchWriteOrder => ({ session, seq: seqs.get(write) ?? 0 });
    // The write in flight for each item.
    const sending = new Map<string, WatchWrite>();
    const listeners = new Set<() => void>();
    let snapshot: ReadonlyMap<string, WatchWrite> = new Map();

    let idleWaiters: (() => void)[] = [];

    const changed = () => {
        snapshot = new Map(pending);
        for (const listener of listeners) listener();
        if (pending.size === 0) {
            const waiters = idleWaiters;
            idleWaiters = [];
            for (const resolve of waiters) resolve();
        }
    };

    const drain = async (id: string) => {
        if (sending.has(id)) return;
        try {
            for (;;) {
                const write = pending.get(id);
                if (!write) return;
                sending.set(id, write);
                let failure: { error: unknown } | null = null;
                try {
                    await send(id, write, orderOf(write));
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

    const writer: WatchlistWriter = {
        pending: () => snapshot,
        session,
        write(id, write) {
            count += 1;
            seqs.set(write, count);
            pending.set(id, write);
            changed();
            void drain(id);
        },
        sendWaiting() {
            for (const [id, write] of pending) {
                // Only a write waiting behind another: the rest are in
                // flight already. Sent alongside the older one, it may land
                // first; its order keeps the older one from replacing it. If
                // the page stays (back-forward cache), drain sends it again;
                // the repeat is ignored.
                const inFlight = sending.get(id);
                if (inFlight !== undefined && inFlight !== write) void send(id, write, orderOf(write)).catch(() => {});
            }
        },
        idle() {
            return pending.size === 0 ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push(resolve));
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    writers.add(writer);
    return writer;
}

const writers = new Set<WatchlistWriter>();

/**
 * For sign-out: waits (for up to `timeoutMs`) until every watchlist write
 * this page made has been sent, while the session still lets them through.
 */
export async function flushWatchlistWrites(timeoutMs = 3000): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        Promise.all([...writers].map((writer) => writer.idle())),
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs); }),
    ]);
    clearTimeout(timeout);
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

/** Saves one item; keepalive, so a write made just before leaving the page still arrives. */
export async function sendWatchWrite(id: string, write: WatchWrite, order: WatchWriteOrder, fetchImpl: Fetch = fetch): Promise<void> {
    await request(fetchImpl, `/api/research/watchlist/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ item: write.item, order }),
        keepalive: true,
    });
}

/** A page ID for write order: a UUID, or random hex where the browser has none. */
export function newWriteSession(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

const encoder = new TextEncoder();

/**
 * Splits `items` into batches whose JSON body stays under `maxBytes` (UTF-8,
 * escapes included) and `maxCount` items. An item too big for any batch on
 * its own goes alone; the route refuses it, and the rest still move.
 */
export function batchBySize<T>(items: readonly T[], { maxBytes, maxCount }: { maxBytes: number; maxCount: number }): T[][] {
    const envelope = encoder.encode('{"items":[]}').length;
    const batches: T[][] = [];
    let batch: T[] = [];
    let bytes = envelope;
    for (const item of items) {
        const size = encoder.encode(JSON.stringify(item)).length;
        // A comma before every item but the first.
        if (batch.length > 0 && (bytes + 1 + size > maxBytes || batch.length >= maxCount)) {
            batches.push(batch);
            batch = [];
            bytes = envelope;
        }
        bytes += (batch.length > 0 ? 1 : 0) + size;
        batch.push(item);
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
}

// Under the import route's 1 MiB limit, with room to spare.
const IMPORT_MAX_BYTES = 900 * 1024;

/** Sends `items` in batches that the server orders as one list. */
export async function importAccountWatchlist(
    items: readonly WatchItemInput[],
    fetchImpl: Fetch = fetch,
    startedAt: number = Date.now(),
): Promise<void> {
    let first = 0;
    // Room for the batch's position fields beside its items.
    for (const batch of batchBySize(items, { maxBytes: IMPORT_MAX_BYTES - 64, maxCount: WATCHLIST_IMPORT_MAX_ITEMS })) {
        await request(fetchImpl, '/api/research/watchlist/import', {
            method: 'POST',
            body: JSON.stringify({ items: batch, first, startedAt }),
        });
        first += batch.length;
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
    const running = imports.get(key);
    if (running) return running;
    const run = (async () => {
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
    })();
    imports.set(key, run);
    run.catch(() => imports.delete(key));
    return run;
}
