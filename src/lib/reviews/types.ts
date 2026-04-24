/**
 * AR-114 — Weekly review types.
 *
 * A weekly review is a short, auto-generated summary of the user's
 * trading activity between Monday 00:00 local and Friday 16:00 local
 * (US-Eastern once live brokerage data carries tz info — local for
 * the seed-journal era). The shape is serialisable; everything but
 * the id is derived from the journal + adherence rules.
 */

export interface WeekBounds {
    /** ISO date for the week's Monday at 00:00 local time. */
    weekStart: string;
    /** ISO date for the week's Friday at 16:00 local time. Closes
     *  before the weekend so "This week" includes the Friday bell. */
    weekEnd: string;
    /** Stable key, e.g. `"wk:2026-04-20"` — the Monday date in
     *  `YYYY-MM-DD` form. Used as the localStorage map key and as
     *  the review id. Avoids the ISO-week pitfalls around year
     *  boundaries (W52/W53/W01 etc.) by just using the Monday date. */
    id: string;
}

/** Tallies broken out the way the narrative wants to read them. */
export interface TradeCount {
    buy: number;
    sell: number;
    rebalance: number;
    total: number;
}

export interface BestDecision {
    tradeId: string;
    label: string;
    impactUsd: number;
}

export interface ReviewStats {
    realizedPnlUsd: number;
    /** Pct change of a nominal NAV used for the review card. Signed. */
    navPctChange: number;
    /** 0–100. Hygiene measure: fraction of trades with thesisId,
     *  conviction ≥ 5, and a non-`none` setup type. */
    ruleAdherence: number;
    /** Count of trades that fell short of the adherence bar. */
    exceptions: number;
    tradeCount: TradeCount;
    bestDecision?: BestDecision;
}

export interface WeeklyReview extends WeekBounds {
    stats: ReviewStats;
    /** Deterministic 2–3 sentence summary built by `buildNarrative`. */
    narrative: string;
    /** Free-text reflection entered by the user; saved on blur. */
    reflection?: string;
    /** Set when the user acknowledges the review (submit or dismiss). */
    acknowledgedAt?: string;
    /** Snooze timestamp set by "Remind me later"; the card re-shows
     *  after `remindAt` passes. */
    remindAt?: string;
}

/** The localStorage-backed, user-controlled slice of a review. The
 *  `stats` + `narrative` are recomputed every page load so only the
 *  human-authored pieces survive across sessions. */
export interface ReviewState {
    reflection?: string;
    acknowledgedAt?: string;
    remindAt?: string;
}
