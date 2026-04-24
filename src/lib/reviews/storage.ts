/**
 * AR-114 — weekly-review persistence.
 *
 * Only the human-authored slice (reflection text, acknowledgement
 * timestamp, remind-later timer) is stored. The stats + narrative
 * are recomputed on every load so the numbers never drift out of
 * sync with the journal.
 *
 * Keyed by the review id (`wk:YYYY-MM-DD`). SSR-safe — every
 * function guards `typeof window`.
 */
import type { ReviewState } from './types';

const LS_KEY = 'pm-weekly-reviews-v1';
/** 24h — the "Remind me later" snooze window. */
export const REMIND_LATER_MS = 86_400_000;

type Store = Record<string, ReviewState>;

function load(): Store {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(LS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed as Store;
        return {};
    } catch {
        return {};
    }
}

function save(store: Store): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(store));
    } catch {
        /* quota / private-mode — silent drop */
    }
}

/** Read the persisted slice for a single review. Returns an empty
 *  object when nothing is stored, which is the "active / no state"
 *  signal the card uses. */
export function getReviewState(id: string): ReviewState {
    const s = load();
    return s[id] ?? {};
}

/** Merge-save reflection text. Doesn't change ack/remind state so
 *  the user can type, walk away, and come back to the same card. */
export function saveReflection(id: string, reflection: string): void {
    const s = load();
    const next: ReviewState = { ...s[id], reflection };
    // Drop empty strings so the card doesn't stash whitespace.
    if (!reflection.trim()) delete next.reflection;
    s[id] = next;
    save(s);
}

/** Mark the review acknowledged (card hides). Optionally captures
 *  the final reflection text in the same write so the archive
 *  shows exactly what was on screen at submit. */
export function acknowledgeReview(id: string, reflection?: string): void {
    const s = load();
    const next: ReviewState = {
        ...s[id],
        acknowledgedAt: new Date().toISOString(),
    };
    if (typeof reflection === 'string' && reflection.trim()) {
        next.reflection = reflection;
    }
    s[id] = next;
    save(s);
}

/** Push the review 24h into the future. Card re-appears after that
 *  window. No-op once acknowledged. */
export function remindLater(id: string): void {
    const s = load();
    if (s[id]?.acknowledgedAt) return;
    s[id] = {
        ...s[id],
        remindAt: new Date(Date.now() + REMIND_LATER_MS).toISOString(),
    };
    save(s);
}

/** True when the card should be visible. Rule: unacknowledged AND
 *  (no remindAt OR remindAt already passed). */
export function isReviewActive(state: ReviewState, now: number = Date.now()): boolean {
    if (state.acknowledgedAt) return false;
    if (!state.remindAt) return true;
    const ts = Date.parse(state.remindAt);
    if (!Number.isFinite(ts)) return true;
    return ts <= now;
}

/** Reset (test helper). Not exported in v1 UI. */
export function clearAllReviews(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(LS_KEY);
    } catch {
        /* ignore */
    }
}
