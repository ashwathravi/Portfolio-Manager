/**
 * Returns comparison — the "cost of breaking your own rules" analytics
 * (AR-111 JournalPlus Integration).
 *
 * Splits a journal into two buckets — trades that passed every rule
 * at submit time vs. trades that broke one or more — and compares
 * the realized-P&L distributions. If either bucket has fewer than
 * `MIN_BUCKET` trades, the comparison returns `null` and the card
 * renders a coach-copy empty state instead. Small samples lie.
 *
 * The math is deliberately simple — arithmetic mean of per-trade %
 * returns (realized P&L over notional). Not time-weighted, not IRR.
 * The point of the card is behavioral, not performance attribution:
 * if following the rules made you 4% per trade and breaking them
 * made you 1.1%, that's the signal. A fancier measure wouldn't add
 * signal, just noise and explanation surface.
 */

import type { JournalEntry } from '@/types/trade';

/** Minimum trades per bucket before we'll show a comparison. Ticket
 *  says ≥ 10; keeps the math honest on a small seed. */
export const MIN_BUCKET = 10;

export interface AdherenceImpact {
    /** Mean per-trade return (as a fraction, 0.042 = 4.2%) for trades
     *  that scored 100 at submit time. */
    adherentMeanReturnPct: number;
    /** Same metric for trades that scored < 100. */
    brokenMeanReturnPct: number;
    /** Count of trades in each bucket. */
    adherentCount: number;
    brokenCount: number;
    /** Delta (adherent − broken). Positive = rules pay off. */
    deltaPct: number;
}

/**
 * Compute the comparison across a journal. Returns `null` when either
 * bucket is under-populated; the caller should render coach copy in
 * that case.
 *
 * Only entries that have a frozen `adherence` are counted — the
 * comparison only speaks to the period where we were recording
 * adherence at submit, so older trades without the freeze are
 * silently ignored.
 */
export function adherenceImpact(
    entries: ReadonlyArray<JournalEntry>,
): AdherenceImpact | null {
    const adherent: number[] = [];
    const broken: number[] = [];

    for (const e of entries) {
        if (!e.adherence) continue;
        if (e.notionalUsd <= 0) continue;
        const returnPct = e.realizedPnlUsd / e.notionalUsd;
        if (e.adherence.score >= 100) adherent.push(returnPct);
        else broken.push(returnPct);
    }

    if (adherent.length < MIN_BUCKET || broken.length < MIN_BUCKET) return null;

    const adherentMean = adherent.reduce((a, b) => a + b, 0) / adherent.length;
    const brokenMean = broken.reduce((a, b) => a + b, 0) / broken.length;

    return {
        adherentMeanReturnPct: adherentMean,
        brokenMeanReturnPct: brokenMean,
        adherentCount: adherent.length,
        brokenCount: broken.length,
        deltaPct: adherentMean - brokenMean,
    };
}

/**
 * Rolling 30-day adherence score for a strategy. The input is the
 * full journal plus the strategy id we're scoring; filters to entries
 * whose rationale thesis maps to this strategy and whose `closedAt`
 * falls inside the window, then averages the frozen scores.
 *
 * Returns `null` when the window has zero trades for this strategy —
 * the header shows an em-dash rather than a misleading "100/100".
 */
export function rollingAdherenceScore(
    entries: ReadonlyArray<JournalEntry>,
    strategyId: string,
    thesisToStrategy: Record<string, string>,
    windowDays: number = 30,
    now: number = Date.now(),
): number | null {
    const cutoff = now - windowDays * 86_400_000;
    let sum = 0;
    let n = 0;
    for (const e of entries) {
        if (!e.adherence) continue;
        const thesis = e.rationale?.thesisId;
        if (!thesis) continue;
        if (thesisToStrategy[thesis] !== strategyId) continue;
        const closed = Date.parse(e.closedAt);
        if (!Number.isFinite(closed) || closed < cutoff) continue;
        sum += e.adherence.score;
        n += 1;
    }
    if (n === 0) return null;
    return Math.round(sum / n);
}

/**
 * Percentile bucket for the header badge. The ticket wants "best
 * quartile" copy when adherence is in the top 25%; we surface that as
 * a coarse tier so the card can render a subtle medal copy without
 * importing a stats library.
 */
export function adherenceTier(
    score: number | null,
): 'top' | 'good' | 'ok' | 'low' | null {
    if (score == null) return null;
    if (score >= 95) return 'top';
    if (score >= 80) return 'good';
    if (score >= 60) return 'ok';
    return 'low';
}
