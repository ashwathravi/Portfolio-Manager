/**
 * AR-112 — Pattern snooze persistence.
 *
 * When the user dismisses a pattern row it disappears for 30 days. The
 * snooze state is a flat `{ [patternId]: expiresAtISO }` map kept in
 * localStorage under the `pm-pattern-snoozed` key, one per signed-in user
 * (src/lib/storage/user-scope.ts). SSR-safe: on the server there is no
 * storage, so reads are empty and writes do nothing.
 *
 * Expired entries are pruned on read, so the map never grows
 * unbounded. The 30-day window is aggressive on purpose — a pattern
 * that was real a month ago is probably still real, and we want it
 * to come back and nag.
 */

import { browserLocalStorage, readUserValue, writeUserValue } from '@/lib/storage/user-scope';

export const SNOOZE_STORAGE_KEY = 'pm-pattern-snoozed';
const SNOOZE_MS = 30 * 86_400_000;

type SnoozeMap = Record<string, string>; // patternId → expiresAt ISO

function load(): SnoozeMap {
    try {
        const raw = readUserValue(browserLocalStorage(), SNOOZE_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed as SnoozeMap;
        return {};
    } catch {
        return {};
    }
}

function save(map: SnoozeMap): void {
    // Quota / private mode: dropped silently, and the next read returns {}.
    writeUserValue(browserLocalStorage(), SNOOZE_STORAGE_KEY, JSON.stringify(map));
}

/** Returns a set of pattern ids currently snoozed (expiry in future).
 *  Prunes expired entries as a side effect — cheap and keeps storage
 *  tidy without a separate GC pass. */
export function getSnoozedIds(): Set<string> {
    const map = load();
    const now = Date.now();
    const out = new Set<string>();
    let dirty = false;
    for (const [id, iso] of Object.entries(map)) {
        const exp = Date.parse(iso);
        if (!Number.isFinite(exp) || exp <= now) {
            delete map[id];
            dirty = true;
            continue;
        }
        out.add(id);
    }
    if (dirty) save(map);
    return out;
}

/** Snooze a pattern for 30 days. Idempotent — re-snoozing the same id
 *  resets the expiry rather than stacking it. */
export function snoozePattern(id: string): void {
    const map = load();
    map[id] = new Date(Date.now() + SNOOZE_MS).toISOString();
    save(map);
}

/** Remove a pattern from the snooze set. Used by a future "Reset
 *  dismissals" action — not wired to any UI today but keeps the
 *  module surface complete. */
export function unsnoozePattern(id: string): void {
    const map = load();
    if (map[id]) {
        delete map[id];
        save(map);
    }
}
