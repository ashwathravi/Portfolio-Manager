import { tickerSchema } from '@/lib/validators/market-data';

/**
 * Watchlist — tickers the user is waiting on, with why and at what price.
 * Persists to localStorage (like theses) until the research workspace moves
 * to the database. Pure functions here; `useWatchlist` wraps them in React.
 *
 * Seed rows are example data (`sample: true`) and carry no price: a stored
 * "current price" would go stale and read as real. Prices come from live
 * quotes or show as a dash.
 */

export interface WatchItem {
    id: string;
    ticker: string;
    companyName: string;
    /** Why it is on the list. */
    reason: string;
    notes: string;
    /** Price the user wants to enter at; null when not set. */
    targetEntry: number | null;
    /** ISO date (YYYY-MM-DD) it was added. */
    addedAt: string;
    sample?: boolean;
}

export type AddWatchError = 'invalid' | 'duplicate';

const DAY_MS = 86_400_000;

function isoDay(ms: number): string {
    return new Date(Math.floor(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/** Uppercases and validates a ticker the way the quote API does. */
export function normalizeTicker(input: string): string | null {
    const candidate = input.trim().toUpperCase();
    return tickerSchema.safeParse(candidate).success ? candidate : null;
}

export function findWatchItem(list: readonly WatchItem[], ticker: string): WatchItem | undefined {
    const t = ticker.trim().toUpperCase();
    return list.find((w) => w.ticker === t);
}

export function addToWatchlist(
    list: readonly WatchItem[],
    input: string,
    opts: { now: number; companyName?: string; reason?: string },
): { list: WatchItem[]; item?: WatchItem; error?: AddWatchError } {
    const ticker = normalizeTicker(input);
    if (!ticker) return { list: [...list], error: 'invalid' };
    const existing = findWatchItem(list, ticker);
    if (existing?.sample) {
        // Adding a ticker that is only on the list as an example (possibly
        // hidden by the example-data toggle) makes it the user's own.
        const adopted: WatchItem = { ...existing };
        delete adopted.sample;
        return { list: list.map((w) => (w.id === existing.id ? adopted : w)), item: adopted };
    }
    if (existing) return { list: [...list], error: 'duplicate' };
    const item: WatchItem = {
        id: `w-${ticker.toLowerCase()}-${opts.now.toString(36)}`,
        ticker,
        companyName: opts.companyName?.trim() ?? '',
        reason: opts.reason?.trim() ?? '',
        notes: '',
        targetEntry: null,
        addedAt: isoDay(opts.now),
    };
    return { list: [item, ...list], item };
}

export function removeFromWatchlist(list: readonly WatchItem[], ticker: string): WatchItem[] {
    const t = ticker.trim().toUpperCase();
    return list.filter((w) => w.ticker !== t);
}

export function updateWatchItem(
    list: readonly WatchItem[],
    id: string,
    patch: Partial<Pick<WatchItem, 'reason' | 'notes' | 'targetEntry'>>,
): WatchItem[] {
    return list.map((w) => {
        if (w.id !== id) return w;
        const next = { ...w, ...patch };
        if (patch.targetEntry !== undefined) {
            next.targetEntry =
                patch.targetEntry != null && Number.isFinite(patch.targetEntry) && patch.targetEntry > 0
                    ? patch.targetEntry
                    : null;
        }
        // An edited example row is the user's now.
        delete next.sample;
        return next;
    });
}

/**
 * % move from the live price to the target entry: negative means the price
 * has to fall to reach the entry. Null without both numbers.
 */
export function distanceToEntryPct(price: number | null | undefined, targetEntry: number | null): number | null {
    if (price == null || !Number.isFinite(price) || price <= 0 || targetEntry == null) return null;
    return ((targetEntry - price) / price) * 100;
}

const SEED: ReadonlyArray<Omit<WatchItem, 'id' | 'addedAt'> & { daysAgo: number }> = [
    {
        ticker: 'COIN',
        companyName: 'Coinbase Global, Inc.',
        reason: 'Trading volume recovery; wants a better entry',
        notes: 'Enter on a pullback to support',
        targetEntry: 145,
        daysAgo: 20,
    },
    {
        ticker: 'PLTR',
        companyName: 'Palantir Technologies Inc.',
        reason: 'AI platform traction in the commercial segment',
        notes: 'Wait for next earnings to confirm commercial growth',
        targetEntry: 16.5,
        daysAgo: 13,
    },
    {
        ticker: 'SHOP',
        companyName: 'Shopify Inc.',
        reason: 'E-commerce recovery and margin expansion',
        notes: 'Add on a market-wide pullback',
        targetEntry: 65,
        daysAgo: 6,
    },
];

/** Example rows, dated relative to `now` (UTC day) so they never look neglected. */
export function seedWatchlist(now: number): WatchItem[] {
    return SEED.map(({ daysAgo, ...w }) => ({
        ...w,
        id: `w-${w.ticker.toLowerCase()}`,
        addedAt: isoDay(now - daysAgo * DAY_MS),
        sample: true,
    }));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const WATCHLIST_STORAGE_KEY = 'atlas:research:watchlist';

/**
 * Storage key per signed-in user, so on a shared browser one account never
 * loads another's tickers and notes.
 */
export function watchlistStorageKey(userId: string | null | undefined): string {
    return `${WATCHLIST_STORAGE_KEY}:${userId?.trim() || 'anonymous'}`;
}

/** Example rows are hidden when the user turns example data off. */
export function visibleWatchItems(list: readonly WatchItem[], showSample: boolean): WatchItem[] {
    return showSample ? [...list] : list.filter((w) => !w.sample);
}

interface Envelope {
    version: 1;
    items: WatchItem[];
}

function coerceItem(v: unknown): WatchItem | null {
    if (typeof v !== 'object' || v === null) return null;
    const r = v as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.ticker !== 'string') return null;
    const ticker = normalizeTicker(r.ticker);
    if (!ticker) return null;
    const target = typeof r.targetEntry === 'number' && Number.isFinite(r.targetEntry) && r.targetEntry > 0 ? r.targetEntry : null;
    return {
        id: r.id,
        ticker,
        companyName: typeof r.companyName === 'string' ? r.companyName : '',
        reason: typeof r.reason === 'string' ? r.reason : '',
        notes: typeof r.notes === 'string' ? r.notes : '',
        targetEntry: target,
        addedAt: typeof r.addedAt === 'string' ? r.addedAt : '',
        ...(r.sample === true ? { sample: true } : {}),
    };
}

/** Null when nothing valid is stored (first visit, or corrupt data). */
export function loadWatchlist(
    storage: Pick<Storage, 'getItem'> | null,
    key: string = WATCHLIST_STORAGE_KEY,
): WatchItem[] | null {
    if (!storage) return null;
    try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<Envelope>;
        if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return null;
        const seen = new Set<string>();
        const items: WatchItem[] = [];
        for (const v of parsed.items) {
            const item = coerceItem(v);
            if (item && !seen.has(item.ticker)) {
                seen.add(item.ticker);
                items.push(item);
            }
        }
        return items;
    } catch {
        return null;
    }
}

/** Returns false when the write failed (quota, privacy mode); the list still works for this session. */
export function saveWatchlist(
    storage: Pick<Storage, 'setItem'> | null,
    items: readonly WatchItem[],
    key: string = WATCHLIST_STORAGE_KEY,
): boolean {
    if (!storage) return false;
    try {
        const envelope: Envelope = { version: 1, items: [...items] };
        storage.setItem(key, JSON.stringify(envelope));
        return true;
    } catch {
        return false;
    }
}
