"use client";

import { MOOD_META, SETUP_META, type TradeRationale } from "@/types/trade";

/**
 * Read-only compact rationale card (AR-109).
 *
 * Renders next to a placed order so the user — and anyone auditing
 * later — can see the "why" at a glance without opening a drawer.
 * Used in the Focus variant's Orders blotter when an order has a
 * `rationale`, and will be re-used by the journal surface (AR-114)
 * and analytics drill-downs.
 *
 * No state, no handlers — the ticket is explicit that there are no
 * edits after submit. If you find yourself adding an onEdit prop here,
 * that decision has been re-opened and the original trade-off
 * (captured thought stays honest) needs a deliberate reversal.
 */
export interface RationaleSummaryProps {
    rationale: TradeRationale;
    /** Hides the header line when the summary is embedded in a row
     *  that already has context (e.g. the blotter row already shows
     *  ticker+side). Default `false` = show the header. */
    compact?: boolean;
}

export function RationaleSummary({ rationale, compact = false }: RationaleSummaryProps) {
    const moodMeta = MOOD_META.find((m) => m.value === rationale.mood);
    const setupMeta = SETUP_META.find((s) => s.value === rationale.setupType);

    // Decision time is interesting at the extremes only: sub-5s reads
    // as reflex (FOMO tail), >5m reads as deliberation. In the middle
    // it's noise, so we don't annotate it.
    const decisionSeconds = Math.max(0, Math.round(rationale.timeToDecisionMs / 1000));
    const decisionTone =
        decisionSeconds < 5
            ? 'fast'
            : decisionSeconds > 300
                ? 'slow'
                : 'steady';

    return (
        <div
            className="pm-rat-summary"
            data-mood-tone={moodMeta?.tone ?? 'ok'}
            data-decision-tone={decisionTone}
        >
            {!compact && (
                <header className="pm-rat-summary-head">
                    <span className="pm-rat-summary-kicker">Rationale</span>
                    <span className="pm-rat-summary-time">
                        Decided in {decisionSeconds}s
                    </span>
                </header>
            )}

            <div className="pm-rat-summary-grid">
                <div className="pm-rat-summary-item">
                    <span className="pm-rat-summary-label">Setup</span>
                    <span className="pm-rat-summary-value">
                        {setupMeta?.label ?? rationale.setupType}
                    </span>
                </div>
                <div className="pm-rat-summary-item">
                    <span className="pm-rat-summary-label">Conviction</span>
                    <span className="pm-rat-summary-value num">
                        {rationale.conviction.toFixed(1)}
                        <span className="pm-rat-summary-scale">/10</span>
                    </span>
                </div>
                <div className="pm-rat-summary-item">
                    <span className="pm-rat-summary-label">Mood</span>
                    <span className="pm-rat-summary-value">
                        <span aria-hidden="true">{moodMeta?.emoji}</span>{' '}
                        {moodMeta?.label ?? rationale.mood}
                    </span>
                </div>
            </div>

            <p className="pm-rat-summary-text">{rationale.rationale}</p>
        </div>
    );
}
