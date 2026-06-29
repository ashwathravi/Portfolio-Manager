/**
 * AR-115 — "Ask Ledger" type surface.
 *
 * v1 ships a deterministic planner + fixed tool catalogue. v2 swaps the
 * planner for `window.claude.complete` without touching the UI layer,
 * which is why these shapes mimic a tool-calling protocol.
 */

/** One chat turn. `citations` is only populated on assistant turns. */
export interface AskMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string; // Markdown
    citations?: AskCitation[];
    /** Unix ms. Used to show per-day rate-limit resets. */
    ts: number;
    /** Tool results attached to the turn. Enables the kv-block renderer
     *  without re-running the tool. Only present on assistant turns. */
    toolRuns?: AskToolRun[];
}

/** A single citation — maps a `[[tool:name#i]]` marker in the markdown
 *  to a route + label so the reader can jump to the underlying view. */
export interface AskCitation {
    /** Marker emitted by the renderer, e.g. `tool:top_alpha_contributors#0`. */
    marker: string;
    /** Human label — usually the tool's shortname. */
    label: string;
    /** Route to jump to when the citation is clicked. */
    href: string;
}

/** A recorded tool call + its result. */
export interface AskToolRun {
    name: AskToolName;
    args: Record<string, unknown>;
    /** The rows returned by the tool. Always a list so the renderer can
     *  lay them out in a kv block. */
    rows: AskRow[];
    /** Optional headline number the renderer can pull without inspecting
     *  `rows` (e.g. `"+$12,340"` for a P&L roll-up). */
    headline?: string;
}

/** Every tool returns a list of these — label / value / optional href. */
export interface AskRow {
    label: string;
    value: string;
    /** Optional sub-label shown muted under the value (e.g. "% of NAV"). */
    sub?: string;
    /** Optional sign hint for tone coloring. */
    tone?: 'pos' | 'neg' | 'warn' | 'neutral';
    /** Optional deep link (overrides the tool's default href for this row). */
    href?: string;
}

export type AskToolName =
    | 'top_alpha_contributors'
    | 'pnl_attribution'
    | 'sector_exposure'
    | 'trades_matching'
    | 'correlation_with'
    | 'alpha_radar_evidence_search'
    | 'policy_breaches'
    | 'stress_test'
    | 'theme_exposure'
    | 'trim_to_target'
    | 'missing_theses'
    | 'cash_jobs'
    | 'churn_risks'
    | 'trade_policy_impact';

/** The full assistant reply, as returned by `runAsk`. */
export interface AskAnswer {
    text: string; // Markdown with [[tool:...]] markers
    citations: AskCitation[];
    toolRuns: AskToolRun[];
}

/** Shape persisted to `pm-ask-v1`. `dayBucket` + `dayCount` drive the
 *  30-msgs/day rate limit. Keeping history + counter in one blob keeps
 *  the read/write surface trivially atomic. */
export interface AskStoreShape {
    history: AskMessage[];
    dayBucket: string; // YYYY-MM-DD local
    dayCount: number;
}
