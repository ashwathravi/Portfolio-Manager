"use client";

import type { Thesis, ThesisConviction } from "@/lib/research/thesis";

/**
 * Phase 5 (AR-78) Thesis list card.
 *
 * Renders a single thesis inside the left-column scroll list on the
 * Research workspace. Selection state and navigation are owned by the
 * parent — this component is purely presentational so the parent can
 * drive it from either local state (AR-78) or a URL-synced selection
 * (future work).
 *
 * Visual anatomy (top to bottom):
 *   - ticker + bull/bear chip · signed distance to target
 *   - company name + one-line thesis title
 *   - 2-line description snippet
 *   - up to 3 tag pills
 *   - conviction chip + time horizon
 *   - progress-to-target bar
 *   - updated stamp + target price
 */

export interface ThesisListCardProps {
    thesis: Thesis;
    selected?: boolean;
    /** When true the card is rendered muted — used on the Archive tab. */
    dimmed?: boolean;
    onSelect?: () => void;
}

const CONVICTION_CLASS: Record<ThesisConviction, string> = {
    HIGH: "pm-chip-conv-high",
    MEDIUM: "pm-chip-conv-med",
    LOW: "pm-chip-conv-low",
};

export function ThesisListCard({
    thesis,
    selected = false,
    dimmed = false,
    onSelect,
}: ThesisListCardProps) {
    const price = thesis.currentPrice ?? 0;
    const hasPriceTarget = price > 0 && thesis.targetPrice > 0;

    // Signed fraction: positive = thesis is working, negative = market
    // moving against us. See `distanceToTarget` for the math.
    const distance = hasPriceTarget
        ? distanceToTarget(price, thesis.targetPrice, thesis.type)
        : 0;
    // Bar fills as the price gets within 25% of target; clamped to [0, 1].
    const fillPct = clamp01(1 - Math.abs(distance) / 0.25);
    const distSign = distance > 0 ? "+" : distance < 0 ? "−" : "";
    const distToneClass =
        distance > 0 ? "pm-num-pos" : distance < 0 ? "pm-num-neg" : "";

    return (
        <button
            type="button"
            className={`pm-thesis-list-card${selected ? " is-selected" : ""}${dimmed ? " is-dimmed" : ""}`}
            aria-pressed={selected}
            onClick={onSelect}
        >
            <header className="pm-thesis-list-head">
                <div className="pm-thesis-list-ticker">
                    <span className="pm-thesis-list-sym">{thesis.ticker}</span>
                    <span
                        className={`pm-thesis-list-dir ${
                            thesis.type === "bull"
                                ? "pm-thesis-list-dir-bull"
                                : "pm-thesis-list-dir-bear"
                        }`}
                    >
                        {thesis.type === "bull" ? "Bull" : "Bear"}
                    </span>
                </div>
                {!dimmed && hasPriceTarget && (
                    <span className={`pm-thesis-list-dist num ${distToneClass}`}>
                        {distSign}
                        {Math.abs(distance * 100).toFixed(1)}%
                    </span>
                )}
            </header>

            <div className="pm-thesis-list-name">
                <span className="pm-thesis-list-company">{thesis.companyName}</span>
                <span className="pm-thesis-list-title">{thesis.title}</span>
            </div>

            <p className="pm-thesis-list-desc">{thesis.description}</p>

            {thesis.tags.length > 0 && (
                <div className="pm-thesis-list-tags">
                    {thesis.tags.slice(0, 3).map((t) => (
                        <span key={t} className="pm-thesis-list-tag">
                            {t}
                        </span>
                    ))}
                    {thesis.tags.length > 3 && (
                        <span className="pm-thesis-list-tag pm-thesis-list-tag-more">
                            +{thesis.tags.length - 3}
                        </span>
                    )}
                </div>
            )}

            <div className="pm-thesis-list-foot">
                <span className={`pm-chip-conv ${CONVICTION_CLASS[thesis.conviction]}`}>
                    {thesis.conviction}
                </span>
                <span className="pm-thesis-list-horizon">{thesis.timeHorizon}</span>
            </div>

            {!dimmed && hasPriceTarget && (
                <div className="pm-thesis-list-progress" aria-hidden="true">
                    <div
                        className={`pm-thesis-list-progress-fill ${distToneClass}`}
                        style={{ width: `${Math.round(fillPct * 100)}%` }}
                    />
                </div>
            )}

            <footer className="pm-thesis-list-meta">
                <span>Updated {formatDate(thesis.dateUpdated)}</span>
                <span className="pm-thesis-list-target">
                    Target ${fmtMoney(thesis.targetPrice)}
                </span>
            </footer>
        </button>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return signed fractional distance to target from the thesis's point of view.
 *
 *   bull: (target - current) / current  → positive means upside remaining.
 *   bear: (current - target) / current  → positive means downside remaining
 *         before target is reached.
 *
 * A small absolute value means the thesis is close to its target price; the
 * progress bar reads that as "nearly full".
 */
function distanceToTarget(
    current: number,
    target: number,
    direction: "bull" | "bear",
): number {
    if (!Number.isFinite(current) || current <= 0 || target <= 0) return 0;
    if (direction === "bull") return (target - current) / current;
    return (current - target) / current;
}

function clamp01(x: number): number {
    if (!Number.isFinite(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
}

function fmtMoney(x: number): string {
    if (!Number.isFinite(x)) return "0";
    return x.toLocaleString(undefined, {
        minimumFractionDigits: x < 10 ? 2 : 0,
        maximumFractionDigits: 2,
    });
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}
