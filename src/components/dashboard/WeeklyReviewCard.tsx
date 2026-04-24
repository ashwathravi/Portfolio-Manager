"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, BellOff } from "lucide-react";
import type { JournalEntry } from "@/types/trade";
import { SEED_JOURNAL } from "@/lib/journal/seed";
import { generateReview } from "@/lib/reviews/generate";
import { currentWeekBounds, formatWeekRange } from "@/lib/reviews/weeks";
import {
    acknowledgeReview,
    getReviewState,
    isReviewActive,
    remindLater,
    saveReflection,
} from "@/lib/reviews/storage";

/**
 * AR-114 — Weekly review ritual (dashboard hero slot).
 *
 * Behaviour:
 *   - On mount, compute the most-recently-completed week's review
 *     from the journal and read the persisted (reflection, ack,
 *     remindAt) slice from localStorage.
 *   - If the review is acknowledged, render nothing — the card only
 *     exists to nudge the weekly ritual.
 *   - If remindAt is in the future, also render nothing until it
 *     passes.
 *   - Reflection textarea: saves on blur.
 *   - "Acknowledge" submits the current reflection + hides the card.
 *   - "Remind me later" snoozes 24h.
 *
 * Rendering nothing is a legitimate state — the dashboard layout
 * flows around it, and tests can force visibility by clearing the
 * `pm-weekly-reviews-v1` key in localStorage.
 */

export interface WeeklyReviewCardProps {
    /** Override the journal source. Defaults to the seed. */
    entries?: JournalEntry[];
    /** Test seam: freeze "now" so the week bounds stay deterministic
     *  across runs. Defaults to `new Date()` at mount time. */
    now?: Date;
}

export function WeeklyReviewCard({ entries = SEED_JOURNAL, now }: WeeklyReviewCardProps) {
    const bounds = useMemo(() => currentWeekBounds(now), [now]);
    const review = useMemo(
        () => generateReview(entries, bounds),
        [entries, bounds],
    );

    // Hydration-safe: start as `false` so the server + first client
    // render match (no visible card), then pull the real state
    // after mount. Prevents "visible then vanish" flashes when the
    // user has already acknowledged.
    const [mounted, setMounted] = useState(false);
    const [reflection, setReflection] = useState("");
    const [active, setActive] = useState(false);

    useEffect(() => {
        const state = getReviewState(review.id);
        setReflection(state.reflection ?? "");
        setActive(isReviewActive(state));
        setMounted(true);
    }, [review.id]);

    const onReflectionBlur = useCallback(() => {
        if (!reflection.trim()) return;
        saveReflection(review.id, reflection);
    }, [review.id, reflection]);

    const onAcknowledge = useCallback(() => {
        acknowledgeReview(review.id, reflection);
        setActive(false);
    }, [review.id, reflection]);

    const onRemindLater = useCallback(() => {
        remindLater(review.id);
        setActive(false);
    }, [review.id]);

    // SSR + pre-mount: render nothing. Also render nothing if not
    // active — a satisfied/dismissed review keeps the dashboard clean.
    if (!mounted || !active) return null;

    const { stats } = review;
    const pnlPositive = stats.realizedPnlUsd >= 0;

    return (
        <section
            className="pm-card pm-card-stack pm-review-card"
            data-testid="weekly-review-card"
            data-week-id={review.id}
            aria-labelledby="pm-review-head"
        >
            <header className="pm-review-head">
                <div>
                    <p className="pm-review-eyebrow">
                        <CalendarClock size={14} aria-hidden="true" />
                        <span>Weekly review · Ritual</span>
                    </p>
                    <h2 id="pm-review-head" className="pm-card-title">
                        Week of {formatWeekRange(review)}
                    </h2>
                    <p className="pm-card-subtitle">
                        Auto-generated · ~2 min read
                    </p>
                </div>
                <div className="pm-review-actions">
                    <button
                        type="button"
                        className="pm-btn pm-btn-ghost"
                        onClick={onRemindLater}
                        data-testid="weekly-review-remind"
                    >
                        <BellOff size={14} aria-hidden="true" />
                        Remind me later
                    </button>
                    <button
                        type="button"
                        className="pm-btn pm-btn-primary"
                        onClick={onAcknowledge}
                        data-testid="weekly-review-acknowledge"
                    >
                        <CheckCircle2 size={14} aria-hidden="true" />
                        Done
                    </button>
                </div>
            </header>

            <div className="pm-review-grid" role="list">
                <StatTile
                    label="Realized P&L"
                    value={formatUsdSigned(stats.realizedPnlUsd)}
                    sub={`${formatPctSigned(stats.navPctChange)} of NAV`}
                    tone={pnlPositive ? "pos" : "neg"}
                    testId="weekly-review-pnl"
                />
                <StatTile
                    label="Rule adherence"
                    value={`${stats.ruleAdherence}/100`}
                    sub={`${stats.exceptions} ${stats.exceptions === 1 ? "exception" : "exceptions"}`}
                    tone={stats.ruleAdherence >= 80 ? "pos" : stats.ruleAdherence >= 60 ? "warn" : "neg"}
                    testId="weekly-review-adherence"
                />
                <StatTile
                    label="Best decision"
                    value={stats.bestDecision?.label ?? "—"}
                    sub={
                        stats.bestDecision
                            ? `${formatUsdSigned(stats.bestDecision.impactUsd)} impact`
                            : "No winning trades closed"
                    }
                    tone={stats.bestDecision ? "pos" : "neutral"}
                    testId="weekly-review-best"
                />
            </div>

            <div className="pm-review-note">
                <p className="pm-review-note-lede">
                    <strong>This week you…</strong> {review.narrative}
                </p>
                <label
                    className="pm-review-reflect-label"
                    htmlFor="pm-review-reflection"
                >
                    <strong>Reflect:</strong>{" "}
                    <em>What did I learn about my process this week?</em>
                </label>
                <textarea
                    id="pm-review-reflection"
                    className="pm-review-reflect"
                    placeholder="One sentence — it's the habit that matters, not the prose."
                    rows={2}
                    value={reflection}
                    onChange={(e) => setReflection(e.target.value)}
                    onBlur={onReflectionBlur}
                    data-testid="weekly-review-reflection"
                />
            </div>
        </section>
    );
}

// --------------------------------------------------------------------- //
// Local helpers — formatters + a compact stat tile
// --------------------------------------------------------------------- //

function formatUsdSigned(n: number): string {
    if (n === 0) return "$0";
    const sign = n > 0 ? "+$" : "-$";
    return `${sign}${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

function formatPctSigned(n: number): string {
    if (!Number.isFinite(n)) return "0.0%";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(1)}%`;
}

interface StatTileProps {
    label: string;
    value: string;
    sub: string;
    tone: "pos" | "neg" | "warn" | "neutral";
    testId: string;
}

function StatTile({ label, value, sub, tone, testId }: StatTileProps) {
    return (
        <div
            role="listitem"
            className="pm-review-stat"
            data-tone={tone}
            data-testid={testId}
        >
            <p className="pm-review-stat-label">{label}</p>
            <p className="pm-review-stat-value">{value}</p>
            <p className="pm-review-stat-sub">{sub}</p>
        </div>
    );
}
