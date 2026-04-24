/**
 * AR-112 — Pattern feed types.
 *
 * A `Pattern` is one surfaced observation: deterministic detectors look
 * for a shape in the journal, and each match produces one of these.
 * Kept small and serializable so the whole feed can live in state and
 * be diffed by reference safely.
 *
 * Severity tiers match the four visual lanes in the design:
 *   - `warn`     red    `!`  (you're losing money / discipline broken)
 *   - `caution`  amber  `↑`  (risk drift; not yet a loss)
 *   - `positive` green  `✓`  (something working — do more of it)
 *   - `info`     blue   `i`  (neutral observation worth noting)
 *
 * `score` ranks the feed (highest first). Detectors return a number in
 * rough "dollars of attention" — $ of P&L at stake, or an equivalent
 * risk-weighted proxy for non-dollar signals. Magnitudes across
 * detectors aren't strictly comparable but the relative ordering is
 * good enough for v1 ("the thing costing me the most shows up first").
 */

import type { JournalEntry } from '@/types/trade';

export type PatternSeverity = 'warn' | 'caution' | 'positive' | 'info';

/**
 * What a user can do from a pattern row. Three shapes:
 *   - `link`    navigate somewhere (e.g. /performance?tradeIds=…)
 *   - `rule`    open the adherence rules editor, optionally pre-filled
 *   - `dismiss` snooze the pattern for 30 days
 *
 * `payload` is action-specific JSON kept deliberately loose; each
 * button's handler unpacks what it needs.
 */
export type PatternActionKind = 'link' | 'rule' | 'dismiss';

export interface PatternAction {
    kind: PatternActionKind;
    label: string;
    /** Visual emphasis — "primary" gets the dark button, the rest are ghosts. */
    variant?: 'primary' | 'ghost';
    /** `link` → { href: string }. `rule` → { kind: string; params?: … }. `dismiss` → undefined. */
    payload?: Record<string, unknown>;
}

/**
 * One observation surfaced to the user. `id` is stable across a
 * regeneration pass so the snooze state keys off it deterministically —
 * detectors bake their parameters into the id (e.g. `late_day_losses:14-15`)
 * so a re-run with the same journal produces the same ids.
 */
export interface Pattern {
    id: string;
    /** Which detector emitted this. Used for analytics + CSS tint. */
    detector: string;
    severity: PatternSeverity;
    /** One-liner with `<em>…</em>` wrapping the key metric. Plain HTML
     *  on purpose — we render it with `dangerouslySetInnerHTML` so the
     *  emphasis survives the AI polish pass. Detectors control the
     *  markup; we don't accept user input here. */
    headline: string;
    /** Two-line explainer. Plain text — no markup. */
    body: string;
    actions: PatternAction[];
    /** Journal entry ids that triggered this pattern. Used by "See
     *  trades" to deep-link the filtered destination. */
    evidenceTradeIds: string[];
    /** Ranking score. Higher = more important. */
    score: number;
    /** ISO timestamp of the regeneration run. Used in the card header
     *  ("Updated 3m ago"). */
    generatedAt: string;
}

/**
 * Pure detector signature — each detector scans the journal and emits
 * zero or more patterns. Deterministic (no Date.now(), no randomness)
 * so the same input reliably produces the same output — critical for
 * the snooze state to stay stable across reloads.
 */
export type PatternDetector = (
    entries: ReadonlyArray<JournalEntry>,
    ctx: DetectorContext,
) => Pattern[];

/**
 * Shared context handed to every detector. Keeps the per-detector
 * signature simple and lets us add fields (current NAV, strategy
 * targets, etc.) without touching every detector.
 */
export interface DetectorContext {
    /** Freeze "now" to a stable ISO timestamp for the whole run — the
     *  same value ends up on every emitted pattern's `generatedAt`. */
    now: string;
    /** Approximate portfolio NAV in USD. Used by detectors that
     *  threshold on percentage of NAV (e.g. `negative_mood_cost`). */
    nav: number;
    /** Ticker → sector map. Fed in from the seed so detectors don't
     *  need to import the journal-freeze module. */
    sectorByTicker: Record<string, string>;
    /** Target sector allocation as fractions (0–1). Used by
     *  `sector_drift` to compare actual vs. target. Missing sectors
     *  default to 0. */
    sectorTargets: Record<string, number>;
}
