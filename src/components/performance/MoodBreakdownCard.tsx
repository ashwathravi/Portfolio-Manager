"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { JournalEntry } from "@/types/trade";
import {
    moodBreakdown,
    totalTaggedTrades,
    worstCautionMood,
    type MoodStat,
} from "@/lib/analytics/mood";

/**
 * AR-110 Mood breakdown card.
 *
 * One row per mood, bar width scales with the absolute dollar stake
 * of that mood (|total P&L| / max), color tints with sign (green for
 * profits, red for losses) and tone (caution moods get the amber
 * treatment even on green rows, so the user sees at a glance that
 * "FOMO made me $100 this month" is still a caution flag).
 *
 * Verdict panel under the table surfaces the worst caution mood —
 * the one costing the most dollars — with a plain-English read-out.
 * The goal is the user looking at this card and thinking "oh, FOMO
 * cost me $1,500 last month" rather than scanning a sheet of numbers.
 *
 * Empty state: below ten tagged trades in range, the full grid is
 * replaced with a coach copy. That threshold is tuned so the card
 * never says anything overconfident about a five-trade sample.
 */

type RangeKey = "30d" | "90d" | "1y" | "all";

const RANGES: ReadonlyArray<{ key: RangeKey; label: string; days: number | null }> = [
    { key: "30d", label: "30d", days: 30 },
    { key: "90d", label: "90d", days: 90 },
    { key: "1y", label: "1Y", days: 365 },
    { key: "all", label: "ALL", days: null },
];

const MIN_TRADES_FOR_ANALYTICS = 10;

export interface MoodBreakdownCardProps {
    trades: JournalEntry[];
    /** Seam for tests. Freezes the "now" used by the range filter so
     *  fixtures stay deterministic across test runs. Omit in real use. */
    now?: number;
}

export function MoodBreakdownCard({ trades, now }: MoodBreakdownCardProps) {
    const [rangeKey, setRangeKey] = useState<RangeKey>("90d");
    const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];

    const { stats, total, worst, maxAbs } = useMemo(() => {
        const stats = moodBreakdown(trades, range.days, now);
        const total = totalTaggedTrades(stats);
        const worst = worstCautionMood(stats);
        const maxAbs = stats.reduce(
            (m, s) => Math.max(m, Math.abs(s.totalPnlUsd)),
            0,
        );
        return { stats, total, worst, maxAbs };
    }, [trades, range.days, now]);

    return (
        <section
            className="pm-card pm-card-stack pm-mood-card"
            data-testid="mood-breakdown"
            aria-labelledby="pm-mood-head"
        >
            <header className="pm-mood-head">
                <div>
                    <h2 id="pm-mood-head" className="pm-card-title">
                        Mood breakdown
                    </h2>
                    <p className="pm-card-subtitle">
                        Realized P&amp;L grouped by the mood tagged at entry
                    </p>
                </div>
                <div
                    className="pm-mood-range"
                    role="tablist"
                    aria-label="Range"
                >
                    {RANGES.map((r) => {
                        const selected = r.key === rangeKey;
                        return (
                            <button
                                key={r.key}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                className={`pm-mood-range-tab${
                                    selected ? " is-on" : ""
                                }`}
                                onClick={() => setRangeKey(r.key)}
                            >
                                {r.label}
                            </button>
                        );
                    })}
                </div>
            </header>

            {total < MIN_TRADES_FOR_ANALYTICS ? (
                <EmptyState count={total} />
            ) : (
                <>
                    <div className="pm-mood-grid" role="table" aria-label="Mood breakdown">
                        <div className="pm-mood-row pm-mood-row-head" role="row">
                            <span role="columnheader">Mood</span>
                            <span role="columnheader">Trades</span>
                            <span role="columnheader">Win rate</span>
                            <span role="columnheader" className="pm-mood-bar-head">
                                Realized P&amp;L
                            </span>
                        </div>
                        {stats.map((s) => (
                            <MoodRow key={s.mood} stat={s} maxAbs={maxAbs} />
                        ))}
                    </div>

                    <Verdict worst={worst} stats={stats} />
                </>
            )}
        </section>
    );
}

// --------------------------------------------------------------------- //
// Row
// --------------------------------------------------------------------- //

interface MoodRowProps {
    stat: MoodStat;
    maxAbs: number;
}

function MoodRow({ stat, maxAbs }: MoodRowProps) {
    const isZero = stat.tradeCount === 0;
    const pct =
        maxAbs === 0 ? 0 : Math.min(100, (Math.abs(stat.totalPnlUsd) / maxAbs) * 100);
    const barStyle: CSSProperties = {
        width: `${pct}%`,
        background: barColor(stat),
    };
    const sign = stat.totalPnlUsd > 0 ? "+" : stat.totalPnlUsd < 0 ? "−" : "";
    const valueFormatted = `${sign}${Math.abs(stat.totalPnlUsd).toLocaleString(
        "en-US",
        { minimumFractionDigits: 0, maximumFractionDigits: 0 },
    )}`;

    return (
        <div
            className={`pm-mood-row${isZero ? " is-empty" : ""}`}
            role="row"
            data-mood={stat.mood}
            data-tone={stat.tone}
        >
            <span role="cell" className="pm-mood-label">
                <span className="pm-mood-emoji" aria-hidden="true">
                    {stat.emoji}
                </span>
                <span>{stat.label}</span>
            </span>
            <span role="cell" className="pm-mood-count">
                {stat.tradeCount}
            </span>
            <span role="cell" className="pm-mood-winrate">
                {isZero ? "—" : `${Math.round(stat.winRate * 100)}%`}
            </span>
            <span role="cell" className="pm-mood-bar-cell">
                <span className="pm-mood-bar-track">
                    <span
                        className="pm-mood-bar-fill"
                        style={barStyle}
                        aria-hidden="true"
                    />
                </span>
                <span
                    className={`pm-mood-bar-value${
                        stat.totalPnlUsd < 0 ? " is-red" : stat.totalPnlUsd > 0 ? " is-green" : ""
                    }`}
                >
                    {isZero ? "—" : `$${valueFormatted}`}
                </span>
            </span>
        </div>
    );
}

function barColor(stat: MoodStat): string {
    if (stat.tradeCount === 0) return "transparent";
    // Caution moods get the warn tint regardless of sign so the user
    // sees the flag even on a "FOMO +$120" row. Ok moods use the
    // standard green/red P&L palette.
    if (stat.tone === "caution") {
        return stat.totalPnlUsd >= 0
            ? "color-mix(in srgb, var(--pm-warn) 55%, transparent)"
            : "color-mix(in srgb, var(--pm-warn) 85%, transparent)";
    }
    const base = stat.totalPnlUsd >= 0 ? "var(--pm-success)" : "var(--pm-danger)";
    return `color-mix(in oklab, ${base} 72%, transparent)`;
}

// --------------------------------------------------------------------- //
// Empty state
// --------------------------------------------------------------------- //

function EmptyState({ count }: { count: number }) {
    const remaining = Math.max(0, MIN_TRADES_FOR_ANALYTICS - count);
    return (
        <div className="pm-mood-empty" data-testid="mood-breakdown-empty">
            <p className="pm-mood-empty-title">Not enough tagged trades yet</p>
            <p className="pm-mood-empty-desc">
                Capture a mood on {remaining} more {remaining === 1 ? "trade" : "trades"}{" "}
                and this board fills in with a personal cost-of-emotion read-out.
            </p>
            <p className="pm-mood-empty-progress">
                {count} / {MIN_TRADES_FOR_ANALYTICS} so far
            </p>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Verdict
// --------------------------------------------------------------------- //

function Verdict({
    worst,
    stats,
}: {
    worst: MoodStat | null;
    stats: MoodStat[];
}) {
    if (worst != null) {
        const dollars = Math.abs(worst.totalPnlUsd).toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });
        const winPct = Math.round(worst.winRate * 100);
        return (
            <footer
                className="pm-mood-verdict is-caution"
                data-testid="mood-verdict"
                data-kind="caution"
            >
                <span className="pm-mood-verdict-emoji" aria-hidden="true">
                    {worst.emoji}
                </span>
                <p className="pm-mood-verdict-copy">
                    <strong>{worst.label}</strong> cost you{" "}
                    <strong>${dollars}</strong> across {worst.tradeCount}{" "}
                    {worst.tradeCount === 1 ? "trade" : "trades"} ({winPct}% win
                    rate). Consider a cooldown before the next one.
                </p>
            </footer>
        );
    }

    // No caution mood is bleeding — lead with the best "ok" mood if
    // there is one. Falls through to a neutral message if somehow
    // every row is zero in range.
    const bestOk = stats
        .filter((s) => s.tone === "ok" && s.totalPnlUsd > 0)
        .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd)[0];

    if (bestOk) {
        const dollars = bestOk.totalPnlUsd.toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });
        return (
            <footer
                className="pm-mood-verdict is-ok"
                data-testid="mood-verdict"
                data-kind="ok"
            >
                <span className="pm-mood-verdict-emoji" aria-hidden="true">
                    {bestOk.emoji}
                </span>
                <p className="pm-mood-verdict-copy">
                    Your <strong>{bestOk.label.toLowerCase()}</strong> trades
                    netted <strong>+${dollars}</strong>. Keep doing that.
                </p>
            </footer>
        );
    }

    return (
        <footer
            className="pm-mood-verdict is-neutral"
            data-testid="mood-verdict"
            data-kind="neutral"
        >
            <p className="pm-mood-verdict-copy">
                Flat across every mood this window. Nothing to learn from it
                yet — let the sample grow.
            </p>
        </footer>
    );
}
