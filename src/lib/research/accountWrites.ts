import type { WriteOrder } from '@/lib/validators/research-ids';

/**
 * Writes to research data kept in the user's account (launch item i38): the
 * watchlist, the decision journal and theses each save one record at a time
 * through these. No React here; `useAccountRecords` wraps them.
 */

export interface AccountWriter<W> {
    /** Writes not yet saved, by record ID. A new map after every change. */
    pending(): ReadonlyMap<string, W>;
    /** This page's ID, sent with every write. */
    readonly session: string;
    write(id: string, write: W): void;
    /** For a page that is closing: sends the writes still waiting behind one in flight, now. */
    sendWaiting(): void;
    /** Resolves once no write is waiting or in flight. */
    idle(): Promise<void>;
    subscribe(listener: () => void): () => void;
}

/** A page ID for write order: a UUID, or random hex where the browser has none. */
export function newWriteSession(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Sends each record's writes one at a time; a write made while one is in
 * flight replaces any still waiting, so only the latest is sent next. Every
 * write carries this page's session and its place in the page's order, so
 * the server keeps the newest even if two arrive out of order (a page
 * closing with one in flight).
 */
export function createAccountWriter<W extends object>({
    send,
    onSaved,
    onFailed,
    session = newWriteSession(),
    // Only the browser's writers wait for sign-out. On the server a writer
    // is made for every render, and the registry would keep each one (and
    // its request's query client) forever.
    register = typeof window !== 'undefined',
}: {
    send: (id: string, write: W, order: WriteOrder) => Promise<void>;
    onSaved: (id: string, write: W) => void;
    onFailed: (id: string, write: W, error: unknown) => void;
    session?: string;
    register?: boolean;
}): AccountWriter<W> {
    const pending = new Map<string, W>();
    // Each write's place in this page's order, numbered as it is made.
    const seqs = new WeakMap<W, number>();
    let count = 0;
    const orderOf = (write: W): WriteOrder => ({ session, seq: seqs.get(write) ?? 0 });
    // The write in flight for each record.
    const sending = new Map<string, W>();
    const listeners = new Set<() => void>();
    let snapshot: ReadonlyMap<string, W> = new Map();

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
                if (write === undefined) return;
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

    const writer: AccountWriter<W> = {
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
    if (register) writers.add(writer as AccountWriter<object>);
    return writer;
}

const writers = new Set<AccountWriter<object>>();

/**
 * For sign-out: waits (for up to `timeoutMs`) until every write this page
 * made to research data has been sent, while the session still lets them
 * through.
 */
export async function flushAccountWrites(timeoutMs = 3000): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        Promise.all([...writers].map((writer) => writer.idle())),
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs); }),
    ]);
    clearTimeout(timeout);
}

export class AccountRequestError extends Error {
    constructor(readonly status: number, readonly code: string | null) {
        super(`Request failed (${status}${code ? ` ${code}` : ''})`);
    }
}

export type Fetch = typeof fetch;

/** A same-origin JSON request; throws AccountRequestError with the API's code when refused. */
export async function accountRequest(fetchImpl: Fetch, path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetchImpl(path, {
        ...init,
        headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
    });
    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
        throw new AccountRequestError(response.status, typeof body?.code === 'string' ? body.code : null);
    }
    return response;
}

const encoder = new TextEncoder();

// Browsers refuse keepalive requests with bodies over 64 KiB.
const KEEPALIVE_MAX_BYTES = 60 * 1024;

/**
 * Saves one record (PUT `{ ...body, order }`). Keepalive when the body is
 * small enough, so a write made just before leaving the page still arrives;
 * a bigger one (a long thesis) is sent as a normal request.
 */
export async function sendRecordWrite(
    fetchImpl: Fetch,
    path: string,
    write: { kind: 'put'; body: Record<string, unknown> },
    order: WriteOrder,
): Promise<void> {
    const body = JSON.stringify({ ...write.body, order });
    await accountRequest(fetchImpl, path, { method: 'PUT', body, keepalive: encoder.encode(body).length <= KEEPALIVE_MAX_BYTES });
}

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

// Under the import routes' 1 MiB limit, with room to spare.
const IMPORT_MAX_BYTES = 900 * 1024;

/**
 * Posts `items` to an import route in batches sized to stay under its body
 * limit. Each batch says where it starts in the list (`first`) and when the
 * move began (`startedAt`), so the server orders every batch as one list.
 */
export async function importInBatches(
    fetchImpl: Fetch,
    path: string,
    items: readonly unknown[],
    maxCount: number,
    startedAt: number = Date.now(),
): Promise<void> {
    let first = 0;
    // Room for the batch's position fields beside its items.
    for (const batch of batchBySize(items, { maxBytes: IMPORT_MAX_BYTES - 64, maxCount })) {
        await accountRequest(fetchImpl, path, { method: 'POST', body: JSON.stringify({ items: batch, first, startedAt }) });
        first += batch.length;
    }
}

const imports = new Map<string, Promise<void>>();

/**
 * Runs `send` for the browser copy under `key` once per page load; `send`
 * removes the copy once the account has it. A failure lets the next call
 * try again.
 */
export function importOnce(key: string, send: () => Promise<void>): Promise<void> {
    const running = imports.get(key);
    if (running) return running;
    const run = send();
    imports.set(key, run);
    run.catch(() => imports.delete(key));
    return run;
}
