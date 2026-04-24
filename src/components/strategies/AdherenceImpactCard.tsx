"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Scale } from "lucide-react";
import type { JournalEntry } from "@/types/trade";
import { adherenceImpact, MIN_BUCKET } from "@/lib/adherence/impact";

/**
 * AR-111 "cost of breaking your own rules" card.
 *
 * Rendered on the Strategies page under the builder surface. Pulls the
 * full journal, splits trades into two buckets — "adherent" (score of
 * 100 at submit time) vs. "broken" (anything less) — and renders the
 * mean per-trade return for each, plus the delta.
 *
 * Under-populated buckets (< `MIN_BUCKET` = 10 trades) render coach
 * copy instead of numbers. Small samples lie; we'd rather show the
 * user "not enough data" than convince them that 3 adherent trades
 * proving their discipline pays off.
 *
 * The math is arithmetic mean of per-trade % returns — not
 * time-weighted, not IRR. The card's job is behavioral, not
 * performance attribution: the takeaway is "following rules = X%,
 * breaking rules = Y%, delta Z%". A fancier measure would add
 * explanation surface without adding signal.
 */

export interface AdherenceImpactCardProps {
    entries: ReadonlyArray<JournalEntry>;
}

function formatPct(fraction: number): string {
    const pct = fraction * 100;
    const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
    return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function AdherenceImpactCard({ entries }: AdherenceImpactCardProps) {
    const impact = useMemo(() => adherenceImpact(entries), [entries]);

    // Count how many journal entries carry an adherence freeze at all —
    // used by the empty state to distinguish "not enough data yet" from
    // "this feature hasn't been wired to your journal".
    const frozenCount = useMemo(
        () => entries.filter((e) => e.adherence).length,
        [entries],
    );

    if (!impact) {
        return (
            <section
                className="pm-card pm-adherence-impact pm-adherence-impact-empty"
                aria-labelledby="pm-adherence-impact-head"
                data-testid="adherence-impact-card"
            >
                <header className="pm-adherence-impact-head">
                    <div>
                        <h3
                            id="pm-adherence-impact-head"
                            className="pm-adherence-impact-title"
                        >
                            Did following your rules pay off?
                        </h3>
                        <p className="pm-adherence-impact-sub">
                            We&rsquo;ll show the mean return for
                            rule-adherent vs. broken trades once each
                            bucket has at least {MIN_BUCKET} closed
                            round-trips.
                        </p>
                    </div>
                </header>
                <div
                    className="pm-adherence-impact-empty-body"
                    data-testid="adherence-impact-empty"
                >
                    <Scale
                        className="pm-adherence-impact-empty-icon"
                        aria-hidden="true"
                    />
                    <p className="pm-adherence-impact-empty-copy">
                        {frozenCount === 0
                            ? "Close a few trades with discipline rules set and this card lights up."
                            : `${frozenCount} trade${frozenCount === 1 ? "" : "s"} with an adherence score so far — we need ≥${MIN_BUCKET} on both sides before a comparison is honest.`}
                    </p>
                </div>
            </section>
        );
    }

    const payoff = impact.deltaPct >= 0;
    const DeltaIcon = payoff ? TrendingUp : TrendingDown;

    return (
        <section
            className="pm-card pm-adherence-impact"
            aria-labelledby="pm-adherence-impact-head"
            data-testid="adherence-impact-card"
            data-payoff={payoff ? "yes" : "no"}
        >
            <header className="pm-adherence-impact-head">
                <div>
                    <h3
                        id="pm-adherence-impact-head"
                        className="pm-adherence-impact-title"
                    >
                        Cost of breaking your own rules
                    </h3>
                    <p className="pm-adherence-impact-sub">
                        Mean per-trade return, rule-adherent vs. one or
                        more rules broken at submit time.
                    </p>
                </div>
                <div
                    className="pm-adherence-impact-delta"
                    data-tone={payoff ? "pos" : "neg"}
                    data-testid="adherence-impact-delta"
                >
                    <DeltaIcon
                        className="pm-adherence-impact-delta-icon"
                        aria-hidden="true"
                    />
                    <span className="pm-adherence-impact-delta-value num">
                        {formatPct(impact.deltaPct)}
                    </span>
                    <span className="pm-adherence-impact-delta-label">
                        delta
                    </span>
                </div>
            </header>

            <div className="pm-adherence-impact-grid">
                <BucketTile
                    label="Followed every rule"
                    hint={`${impact.adherentCount} trade${impact.adherentCount === 1 ? "" : "s"}`}
                    value={impact.adherentMeanReturnPct}
                    tone="pos"
                    testid="adherence-impact-adherent"
                />
                <BucketTile
                    label="Broke at least one rule"
                    hint={`${impact.brokenCount} trade${impact.brokenCount === 1 ? "" : "s"}`}
                    value={impact.brokenMeanReturnPct}
                    tone="neg"
                    testid="adherence-impact-broken"
                />
            </div>

            <footer className="pm-adherence-impact-foot">
                {payoff ? (
                    <>
                        <strong>Rules paid off</strong> by{" "}
                        {formatPct(Math.abs(impact.deltaPct))} per trade
                        over the measurement window. Keep the palette
                        tight.
                    </>
                ) : (
                    <>
                        <strong>Rules underperformed</strong> by{" "}
                        {formatPct(Math.abs(impact.deltaPct))} per trade.
                        Worth a look — either the rules are miscalibrated
                        or the sample is still small.
                    </>
                )}
            </footer>
        </section>
    );
}

function BucketTile({
    label,
    hint,
    value,
    tone,
    testid,
}: {
    label: string;
    hint: string;
    value: number;
    tone: "pos" | "neg";
    testid: string;
}) {
    const displayTone = value > 0 ? "pos" : value < 0 ? "neg" : "neutral";
    return (
        <div
            className="pm-adherence-impact-tile"
            data-label-tone={tone}
            data-testid={testid}
        >
            <span className="pm-adherence-impact-tile-label">{label}</span>
            <span
                className={`pm-adherence-impact-tile-value num pm-num-${displayTone}`}
            >
                {formatPct(value)}
            </span>
            <span className="pm-adherence-impact-tile-hint">{hint}</span>
        </div>
    );
}
