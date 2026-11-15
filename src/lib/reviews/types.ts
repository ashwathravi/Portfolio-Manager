/**
 * AR-114 — Weekly review types.
 *
 * A weekly review is a short, auto-generated summary of the user's
 * trading activity in one New York calendar week, Monday 00:00 ET up to
 * the next Monday 00:00 ET (src/lib/reviews/weeks.ts). The shape is
 * serialisable; everything but the id is derived from the journal +
 * adherence rules.
 */

export interface WeekBounds {
    /** The week's Monday at 00:00 ET, as an ISO instant: the first
     *  moment a trade with a time counts in it. */
    weekStart: string;
    /** The next Monday at 00:00 ET: the first moment that counts in the
     *  week after, not in this one. Weeks meet, so a trade made on a
     *  Friday evening or a weekend is in exactly one. */
    weekEnd: string;
    /** When the week's last session closed (the NYSE calendar: usually
     *  Friday 4:00 PM ET, Thursday's close when Friday is a holiday). The
     *  week's review is ready from then. */
    closesAt: string;
    /** Stable key, e.g. `"wk:2026-04-20"` — the Monday date in
     *  `YYYY-MM-DD` form. Used as the localStorage map key and as
     *  the review id. Avoids the ISO-week pitfalls around year
     *  boundaries (W52/W53/W01 etc.) by just using the Monday date. */
    id: string;
    /** `YYYY-MM-DD` of the week's Monday and Sunday, Eastern: the days a
     *  trade stored with a date and no time (launch item i51) counts on. */
    firstDay: string;
    lastDay: string;
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
    /** Realized P&L as a percent of net worth. Signed; null when net
     *  worth isn't known. */
    navPctChange: number | null;
    /** 0–100. Hygiene measure: fraction of trades with thesisId,
     *  conviction ≥ 5, and a non-`none` setup type. Only trades with a
     *  rationale recorded on Trade are scored; null when none are. */
    ruleAdherence: number | null;
    /** Count of scored trades that fell short of the adherence bar. */
    exceptions: number;
    /** Count of captured Risk Policy Engine overrides in the review window. */
    policyExceptions: number;
    /** Count of sell-discipline audit actions in the review window. */
    sellDisciplineEvents: number;
    /** Count of ticker-level churn warnings detected in the review window. */
    churnWarnings: number;
    /** Top repeated/churned symbols for the week, sorted by score. */
    churnSymbols: string[];
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
