/**
 * AR-115 — Ask Ledger localStorage persistence.
 *
 * One blob under `pm-ask-v1` keeps three things in sync:
 *   - `history` — last 50 assistant/user turns
 *   - `dayBucket` — local YYYY-MM-DD for the day-limit window
 *   - `dayCount` — number of user questions sent today
 *
 * Keeping the counter in the same blob as history keeps reads/writes
 * atomic and the day-limit logic local. All helpers are SSR-safe; on
 * the server they return sentinel defaults so the module can be
 * imported from both component types without guards at the callsite.
 */
import type { AskMessage, AskStoreShape } from './types';

const KEY = 'pm-ask-v1';
/** Hard cap on persisted turns so the blob never grows unbounded. */
const HISTORY_CAP = 50;
/** Daily message cap — matches the rate-limit banner copy. */
export const DAILY_LIMIT = 30;

function isoDay(date: Date): string {
    // Local calendar day, not UTC. Rate limits should roll at user midnight.
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function emptyStore(now: Date = new Date()): AskStoreShape {
    return { history: [], dayBucket: isoDay(now), dayCount: 0 };
}

/** SSR-safe read. Returns an empty store if the key is missing or malformed. */
export function getStore(now: Date = new Date()): AskStoreShape {
    if (typeof window === 'undefined') return emptyStore(now);
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return emptyStore(now);
        const parsed = JSON.parse(raw) as Partial<AskStoreShape>;
        // Coerce missing fields — shipping a partial blob from a prior
        // build shouldn't crash the reader.
        const history = Array.isArray(parsed.history) ? parsed.history : [];
        const dayBucket = typeof parsed.dayBucket === 'string' ? parsed.dayBucket : isoDay(now);
        const dayCount = typeof parsed.dayCount === 'number' ? parsed.dayCount : 0;
        return { history, dayBucket, dayCount };
    } catch {
        return emptyStore(now);
    }
}

function writeStore(store: AskStoreShape): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
        /* storage full / private mode — silently drop */
    }
}

/** Rollover helper. If the stored bucket is stale, returns a fresh
 *  store with `dayCount` reset to zero. */
function rolledOver(store: AskStoreShape, now: Date): AskStoreShape {
    const today = isoDay(now);
    if (store.dayBucket === today) return store;
    return { ...store, dayBucket: today, dayCount: 0 };
}

/** Append a message and persist. Trims the oldest entries when over
 *  `HISTORY_CAP`. Returns the updated store. */
export function saveMessage(msg: AskMessage, now: Date = new Date()): AskStoreShape {
    const current = rolledOver(getStore(now), now);
    const history = [...current.history, msg];
    // Drop from the front so the most recent turns survive.
    const trimmed = history.length > HISTORY_CAP ? history.slice(history.length - HISTORY_CAP) : history;
    const next: AskStoreShape = { ...current, history: trimmed };
    writeStore(next);
    return next;
}

/** Returns today's question count, rolling the bucket forward if needed. */
export function getDayCount(now: Date = new Date()): number {
    const rolled = rolledOver(getStore(now), now);
    // If a rollover happened we need to persist the reset so the next
    // read starts clean too.
    if (rolled.dayBucket !== getStore(now).dayBucket) writeStore(rolled);
    return rolled.dayCount;
}

/** Bumps today's counter and persists. Returns the new count. */
export function incrementDayCount(now: Date = new Date()): number {
    const rolled = rolledOver(getStore(now), now);
    const next: AskStoreShape = { ...rolled, dayCount: rolled.dayCount + 1 };
    writeStore(next);
    return next.dayCount;
}

/** Test + "clear chat" helper. Wipes history + resets the counter. */
export function clearHistory(now: Date = new Date()): AskStoreShape {
    const fresh = emptyStore(now);
    writeStore(fresh);
    return fresh;
}

/** True when today's count has hit the daily cap. */
export function isRateLimited(now: Date = new Date()): boolean {
    return getDayCount(now) >= DAILY_LIMIT;
}
