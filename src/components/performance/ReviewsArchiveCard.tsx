"use client";

import { useEffect, useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import type { JournalEntry } from "@/types/trade";
import { generateReview } from "@/lib/reviews/generate";
import { formatWeekRange, listRecentWeeks } from "@/lib/reviews/weeks";
import { getReviewState } from "@/lib/reviews/storage";
import type { WeeklyReview } from "@/lib/reviews/types";

/**
 * AR-114 — Performance › Reviews archive.
 *
 * Lists the last `limit` weekly reviews with their stats side-by-side
 * and the user's saved reflection (if any) under the row. Reviews are
 * recomputed from the journal on every mount so the archive always
 * reflects the current numbers — only reflections + ack timestamps
 * are loaded from localStorage.
 *
 * Non-goals:
 *   - Custom date-range picker (v2 — the current 8-week window covers
 *     ~two months which is the right browse depth for v1).
 *   - Deep-linking to a single review page. Spec says inline archive
 *     rows, so an inline table is what we ship.
 */

const DEFAULT_LIMIT = 8;

export interface ReviewsArchiveCardProps {
    entries: JournalEntry[];
    /** How many past weeks to render. Defaults to 8. */
    limit?: number;
    /** Test seam: freeze "now" so bounds stay deterministic. */
    now?: Date;
}

interface ArchiveRow {
    review: WeeklyReview;
    reflection?: string;
    acknowledgedAt?: string;
}

export function ReviewsArchiveCard({
    entries,
    limit = DEFAULT_LIMIT,
    now,
}: ReviewsArchiveCardProps) {
    const weeks = useMemo(() => listRecentWeeks(limit, now), [limit, now]);
    const reviews = useMemo(
        () => weeks.map((bounds) => generateReview(entries, bounds)),
        [entries, weeks],
    );

    // Hydration-safe: render rows with empty reflections on SSR, then
    // hydrate reflections from localStorage after mount.
    const [rows, setRows] = useState<ArchiveRow[]>(() =>
        reviews.map((r) => ({ review: r })),
    );

    useEffect(() => {
        // Archive rows include client-only persisted review state.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRows(
            reviews.map((r) => {
                const state = getReviewState(r.id);
                return {
                    review: r,
                    reflection: state.reflection,
                    acknowledgedAt: state.acknowledgedAt,
                };
            }),
        );
    }, [reviews]);

    return (
        <section
            className="pm-card pm-card-stack pm-reviews-archive"
            data-testid="reviews-archive"
            aria-labelledby="pm-reviews-archive-head"
        >
            <header className="pm-reviews-archive-head">
                <div>
                    <p className="pm-reviews-archive-eyebrow">
                        <ListChecks size={14} aria-hidden="true" />
                        <span>Reviews · Archive</span>
                    </p>
                    <h2
                        id="pm-reviews-archive-head"
                        className="pm-card-title"
                    >
                        Weekly reviews
                    </h2>
                    <p className="pm-card-subtitle">
                        The last {limit} weeks of auto-generated summaries and
                        your reflections. Stats update live from the journal;
                        reflections persist per device.
                    </p>
                </div>
            </header>

            {rows.length === 0 ? (
                <div
                    className="pm-reviews-archive-empty"
                    data-testid="reviews-archive-empty"
                >
                    <p>No weeks to show yet.</p>
                    <p className="pm-reviews-archive-empty-sub">
                        Reviews appear here as the weeks roll forward.
                    </p>
                </div>
            ) : (
                <ul className="pm-reviews-archive-list" role="list">
                    {rows.map(({ review, reflection, acknowledgedAt }) => {
                        const hasActivity = review.stats.tradeCount.total > 0;
                        return (
                            <li
                                key={review.id}
                                className="pm-reviews-archive-row"
                                data-testid="reviews-archive-row"
                                data-week-id={review.id}
                                data-empty={hasActivity ? "false" : "true"}
                            >
                                <div className="pm-reviews-archive-meta">
                                    <p className="pm-reviews-archive-range">
                                        Week of {formatWeekRange(review)}
                                    </p>
                                    <p className="pm-reviews-archive-narr">
                                        {review.narrative}
                                    </p>
                                    {reflection && (
                                        <p
                                            className="pm-reviews-archive-reflect"
                                            data-testid="reviews-archive-reflection"
                                        >
                                            <strong>Reflection:</strong>{" "}
                                            {reflection}
                                        </p>
                                    )}
                                </div>
                                <div
                                    className="pm-reviews-archive-stats"
                                    role="list"
                                >
                                    <MiniStat
                                        label="Realized"
                                        value={formatUsdSigned(review.stats.realizedPnlUsd)}
                                        tone={
                                            review.stats.realizedPnlUsd >= 0
                                                ? "pos"
                                                : "neg"
                                        }
                                    />
                                    <MiniStat
                                        label="Adherence"
                                        value={`${review.stats.ruleAdherence}/100`}
                                        tone={
                                            review.stats.ruleAdherence >= 80
                                                ? "pos"
                                                : review.stats.ruleAdherence >= 60
                                                  ? "warn"
                                                  : "neg"
                                        }
                                    />
                                    <MiniStat
                                        label="Trades"
                                        value={String(
                                            review.stats.tradeCount.total,
                                        )}
                                        tone="neutral"
                                    />
                                </div>
                                {acknowledgedAt && (
                                    <span
                                        className="pm-reviews-archive-ack"
                                        title={`Acknowledged ${acknowledgedAt}`}
                                        data-testid="reviews-archive-ack"
                                    >
                                        Reviewed
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

// --------------------------------------------------------------------- //
// Local mini-stat + formatters
// --------------------------------------------------------------------- //

interface MiniStatProps {
    label: string;
    value: string;
    tone: "pos" | "neg" | "warn" | "neutral";
}

function MiniStat({ label, value, tone }: MiniStatProps) {
    return (
        <div className="pm-reviews-archive-mini" data-tone={tone} role="listitem">
            <span className="pm-reviews-archive-mini-label">{label}</span>
            <span className="pm-reviews-archive-mini-value">{value}</span>
        </div>
    );
}

function formatUsdSigned(n: number): string {
    if (n === 0) return "$0";
    const sign = n > 0 ? "+$" : "-$";
    return `${sign}${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}
