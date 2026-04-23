"use client";

import { type CSSProperties, type ReactNode } from "react";
import { Sparkline } from "@/components/charts";

/**
 * Phase 3 (AR-70) StatCard primitive — the Ledger variant.
 *
 * Used by the Dashboard 4-card stat row (Net Worth, Today's P&L, Alpha vs S&P,
 * Cash Runway) and the Holdings 6-metric strip. Legacy
 * `@/components/data-display/StatCard` still exists for screens that haven't
 * been migrated yet; once every caller is on this version we'll retire it.
 *
 * Layout:
 *
 *     ┌──────────────────────────────────────────┐
 *     │ [icon] LABEL                    [spark] │
 *     │                                          │
 *     │ $VALUE                                   │
 *     │                                          │
 *     │ [±chip]  sub text                        │
 *     └──────────────────────────────────────────┘
 *
 * Props mirror the handoff API exactly so designs from `pages/Dashboard.jsx`
 * drop in unchanged: `{ label, value, delta?, sub?, positive?, sparkSeed?, icon? }`.
 *
 * `positive` is explicit so callers can override the auto-color when a higher
 * `delta` is actually bad (e.g., "Days of runway went from 120 → 90" is
 * negative even though 90 isn't negative-signed). When omitted, we infer it
 * from `delta` sign.
 */

export interface StatCardProps {
    /** Short label above the value — e.g. "Net Worth". */
    label: string;
    /** The big number. Pre-formatted (we don't do currency here). */
    value: string;
    /** Delta string (e.g. "+2.4%", "−$1,203"). Colored by `positive`. */
    delta?: string;
    /** Small muted text alongside the delta chip — e.g. "vs last month". */
    sub?: string;
    /**
     * Explicit positive/negative state. If omitted, inferred from `delta`:
     *   "+", "↑", or unsigned number ≥ 0  → positive
     *   "−", "-", "↓", or unsigned number < 0 → negative
     *   anything else → neutral.
     */
    positive?: boolean;
    /**
     * Optional numeric series to render as a mini sparkline in the top-right.
     * Named `sparkSeed` to match the handoff spec — in practice this is just
     * the series values (not a PRNG seed).
     */
    sparkSeed?: number[];
    /** Optional icon shown in a tinted tile on the left of the label row. */
    icon?: ReactNode;
    /** Accessible label override; defaults to `${label} ${value}`. */
    ariaLabel?: string;
    className?: string;
    style?: CSSProperties;
}

export function StatCard({
    label,
    value,
    delta,
    sub,
    positive,
    sparkSeed,
    icon,
    ariaLabel,
    className,
    style,
}: StatCardProps) {
    const resolvedPositive = resolvePositive(delta, positive);
    const chipClass =
        resolvedPositive === true
            ? "pm-stat-chip pm-stat-chip-pos"
            : resolvedPositive === false
              ? "pm-stat-chip pm-stat-chip-neg"
              : "pm-stat-chip pm-stat-chip-neutral";

    const sparkColor =
        resolvedPositive === false ? "var(--pm-danger)" : "var(--pm-success)";

    return (
        <div
            className={`pm-stat-card${className ? ` ${className}` : ""}`}
            style={style}
            aria-label={ariaLabel ?? `${label} ${value}`}
            role="group"
        >
            <div className="pm-stat-row">
                <div className="pm-stat-label-group">
                    {icon && <span className="pm-stat-icon" aria-hidden="true">{icon}</span>}
                    <span className="pm-stat-label">{label}</span>
                </div>
                {sparkSeed && sparkSeed.length > 1 && (
                    <Sparkline
                        data={sparkSeed}
                        width={72}
                        height={22}
                        color={sparkColor}
                        strokeWidth={1.25}
                        fill
                        ariaLabel={`${label} trend`}
                        className="pm-stat-spark"
                    />
                )}
            </div>

            <div className="pm-stat-value">{value}</div>

            {(delta || sub) && (
                <div className="pm-stat-footer">
                    {delta && <span className={chipClass}>{delta}</span>}
                    {sub && <span className="pm-stat-sub">{sub}</span>}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Figure out whether a delta is positive, negative, or neutral.
 *
 *   - Caller-supplied `positive` wins when defined.
 *   - "+" / "↑" prefix → positive.
 *   - "−" / "-" / "↓" prefix → negative.
 *   - Otherwise parse the first signed number we can find; 0 → neutral.
 */
export function resolvePositive(
    delta: string | undefined,
    explicit: boolean | undefined,
): boolean | null {
    if (explicit !== undefined) return explicit;
    if (!delta) return null;

    const trimmed = delta.trim();
    if (!trimmed) return null;

    const firstChar = trimmed[0];
    if (firstChar === "+" || firstChar === "↑") return true;
    if (firstChar === "−" || firstChar === "-" || firstChar === "↓") return false;

    // No explicit sign — try to parse a number out of the string.
    const match = trimmed.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const n = Number(match[0]);
    if (!Number.isFinite(n) || n === 0) return null;
    return n > 0;
}
