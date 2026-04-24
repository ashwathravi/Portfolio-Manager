"use client";

import type { Strategy } from "@/lib/strategies/strategy";

/**
 * Phase 6 (AR-80) Strategy selection card.
 *
 * Purely presentational — parent owns which strategy is selected and passes
 * the `selected` flag in. Renders the top-row cards on the Strategy builder
 * page. Each card shows:
 *   - status pill (active / paused / backtesting)
 *   - shortId (S-001) in mono
 *   - strategy name + one-line description
 *   - optional rolling 30-day adherence score (AR-111)
 *   - 4 readouts: Total return / Sharpe / Max DD / Win rate
 *
 * The selected card gets an accent border + ambient shadow so the user
 * always knows which strategy the rule builder + backtest surface below
 * is currently reflecting.
 *
 * When a strategy is still in the `backtesting` status its stats are zero
 * — we render em-dashes instead of "0.00%" so the card doesn't lie about
 * a result that hasn't been computed yet.
 */

export interface StrategyCardProps {
    strategy: Strategy;
    selected?: boolean;
    onSelect?: () => void;
    /** AR-111 rolling 30-day adherence score for this strategy. `null` =
     *  no data in the window (seed trades may not cover every strategy). */
    adherenceScore?: number | null;
    /** AR-111 tier from `adherenceTier(score)`. Drives the color of the
     *  pill so top-quartile strategies read distinct from the rest. */
    adherenceTier?: 'top' | 'good' | 'ok' | 'low' | null;
}

const STATUS_LABEL: Record<Strategy["status"], string> = {
    active: "Active",
    paused: "Paused",
    backtesting: "Backtesting",
};

const STATUS_CLASS: Record<Strategy["status"], string> = {
    active: "pm-strategy-status-active",
    paused: "pm-strategy-status-paused",
    backtesting: "pm-strategy-status-backtesting",
};

function formatSignedPct(pct: number): string {
    if (pct === 0) return "—";
    const sign = pct > 0 ? "+" : "−";
    return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

function formatPct(pct: number): string {
    if (pct === 0) return "—";
    return `${pct.toFixed(1)}%`;
}

function formatRatio(r: number): string {
    if (r === 0) return "—";
    return r.toFixed(2);
}

export function StrategyCard({
    strategy,
    selected = false,
    onSelect,
    adherenceScore = null,
    adherenceTier = null,
}: StrategyCardProps) {
    const { stats, status } = strategy;
    const hasRun = status !== "backtesting";

    const returnTone =
        hasRun && stats.totalReturnPct > 0
            ? "pm-num-pos"
            : hasRun && stats.totalReturnPct < 0
                ? "pm-num-neg"
                : "";
    const ddTone = hasRun && stats.maxDrawdownPct < 0 ? "pm-num-neg" : "";

    return (
        <button
            type="button"
            className={`pm-strategy-card${selected ? " is-selected" : ""}`}
            aria-pressed={selected}
            onClick={onSelect}
        >
            <header className="pm-strategy-card-head">
                <span className={`pm-strategy-status ${STATUS_CLASS[status]}`}>
                    {status === "active" && <span className="pm-live-dot" aria-hidden="true" />}
                    {STATUS_LABEL[status]}
                </span>
                <span className="pm-strategy-shortid">{strategy.shortId}</span>
            </header>

            <div className="pm-strategy-name">{strategy.name}</div>
            <p className="pm-strategy-desc">{strategy.description}</p>

            {adherenceScore != null && (
                <div
                    className="pm-strategy-adherence"
                    data-tier={adherenceTier ?? 'none'}
                    data-testid="strategy-card-adherence"
                    aria-label={`30-day adherence ${adherenceScore} of 100`}
                    title="Rolling 30-day rule adherence"
                >
                    <span className="pm-strategy-adherence-label">
                        30d adherence
                    </span>
                    <span className="pm-strategy-adherence-value num">
                        {adherenceScore}
                        <span className="pm-strategy-adherence-max">/ 100</span>
                    </span>
                </div>
            )}

            <div className="pm-strategy-stats">
                <div className="pm-readout">
                    <span className="pm-readout-label">Total return</span>
                    <span className={`pm-readout-value num ${returnTone}`}>
                        {formatSignedPct(stats.totalReturnPct)}
                    </span>
                </div>
                <div className="pm-readout">
                    <span className="pm-readout-label">Sharpe</span>
                    <span className="pm-readout-value num">{formatRatio(stats.sharpe)}</span>
                </div>
                <div className="pm-readout">
                    <span className="pm-readout-label">Max DD</span>
                    <span className={`pm-readout-value num ${ddTone}`}>
                        {hasRun ? `${stats.maxDrawdownPct.toFixed(1)}%` : "—"}
                    </span>
                </div>
                <div className="pm-readout">
                    <span className="pm-readout-label">Win rate</span>
                    <span className="pm-readout-value num">{formatPct(stats.winRatePct)}</span>
                </div>
            </div>
        </button>
    );
}
