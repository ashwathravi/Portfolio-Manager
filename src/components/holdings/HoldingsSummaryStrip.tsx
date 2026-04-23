"use client";

/**
 * Phase 4 (AR-74) Holdings summary strip.
 *
 * Six cells separated by thin dividers, each a label + value stack. The cells
 * are computed by the parent from the live-quote-enriched holdings set — we
 * just render, so the strip can stay pure.
 *
 * Layout (desktop):
 *
 *   │ Market value  │ Unrealized gain │ Today P&L │ Positions │ Avg hold │ Concentration │
 *   │ $154,230      │ +$12,450 (8.8%) │ +$1,203   │ 14        │ 284d     │ 47%  top 3    │
 */

export interface HoldingsSummaryStripProps {
    marketValue: number;
    unrealizedGain: number;
    unrealizedGainPct: number;
    todayPnL: number;
    positions: number;
    /** Days — already computed by the caller. */
    avgHoldingDays: number;
    /** Share of total MV in the top 3 names, expressed as a fraction of 1. */
    concentrationTop3: number;
    className?: string;
}

export function HoldingsSummaryStrip({
    marketValue,
    unrealizedGain,
    unrealizedGainPct,
    todayPnL,
    positions,
    avgHoldingDays,
    concentrationTop3,
    className,
}: HoldingsSummaryStripProps) {
    const gainClass =
        unrealizedGain > 0
            ? "pm-num-pos"
            : unrealizedGain < 0
              ? "pm-num-neg"
              : "";
    const todayClass =
        todayPnL > 0
            ? "pm-num-pos"
            : todayPnL < 0
              ? "pm-num-neg"
              : "";
    return (
        <section
            className={`pm-summary-strip${className ? ` ${className}` : ""}`}
            aria-label="Holdings summary"
        >
            <StripCell label="Market value" value={fmtCurrency0(marketValue)} />
            <StripCell
                label="Unrealized gain"
                value={`${fmtSigned0(unrealizedGain)} (${fmtSignedPct(unrealizedGainPct)})`}
                valueClass={gainClass}
            />
            <StripCell
                label="Today P&L"
                value={fmtSigned0(todayPnL)}
                valueClass={todayClass}
            />
            <StripCell label="Positions" value={String(positions)} />
            <StripCell label="Avg holding period" value={fmtDays(avgHoldingDays)} />
            <StripCell
                label="Concentration"
                value={`${(concentrationTop3 * 100).toFixed(0)}%`}
                hint="top 3 names"
            />
        </section>
    );
}

function StripCell({
    label,
    value,
    valueClass,
    hint,
}: {
    label: string;
    value: string;
    valueClass?: string;
    hint?: string;
}) {
    return (
        <div className="pm-summary-cell">
            <span className="pm-summary-label">{label}</span>
            <span className={`pm-summary-value${valueClass ? ` ${valueClass}` : ""}`}>
                {value}
            </span>
            {hint && <span className="pm-summary-hint">{hint}</span>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Formatters — intentionally inline (no shared fmt util yet; would dwarf
// the rest of the file).
// ---------------------------------------------------------------------------

function fmtCurrency0(n: number): string {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtSigned0(n: number): string {
    if (!Number.isFinite(n) || n === 0) return "$0";
    const sign = n > 0 ? "+" : "−";
    return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtSignedPct(n: number): string {
    if (!Number.isFinite(n)) return "0.0%";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return `${sign}${Math.abs(n).toFixed(1)}%`;
}

function fmtDays(days: number): string {
    if (!Number.isFinite(days) || days <= 0) return "—";
    if (days < 30) return `${Math.round(days)}d`;
    const months = days / 30;
    if (months < 18) return `${months.toFixed(0)}mo`;
    return `${(days / 365).toFixed(1)}y`;
}
