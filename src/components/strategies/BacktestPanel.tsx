"use client";

import { Check } from "lucide-react";
import { AreaChart } from "@/components/charts/AreaChart";
import type {
    BacktestStats,
    MonteCarloCell,
    PromotionStatus,
    PromotionStep,
    Strategy,
    StrategyBacktest,
} from "@/lib/strategies/strategy";

/**
 * Phase 6 (AR-82) Backtest · Monte Carlo · Promotion.
 *
 * The right 36% of the builder split. Summarizes everything we've
 * learned about the strategy's historical behavior:
 *
 *   1. HEAD — window label + robustness verdict pill (Robust, Fragile,
 *      Promising, Unproven) tinted to match the verdict.
 *   2. EQUITY CURVE — 200px AreaChart over the full backtest window.
 *      No benchmark line — this panel is about the strategy itself, not
 *      its relative performance (that's a separate future card).
 *   3. STATS GRID — 2×4 readout grid: CAGR, Net profit, Sharpe, Sortino,
 *      Max DD, Profit factor, Trades, Win rate.
 *   4. MONTE CARLO — 5 percentile cells (95/75/50/25/5), median
 *      highlighted, each showing terminal multiplier + implied CAGR.
 *   5. PROMOTION LADDER — 5 steps (Rules → Backtest → Robustness →
 *      Paper → Live) with done/active/pending states.
 *
 * Purely presentational — edits to the strategy (rules, guardrails)
 * re-feed this component but we don't recompute the backtest here. That
 * round-trip lands when the backtest engine is wired in the follow-up.
 */

export interface BacktestPanelProps {
    strategy: Strategy;
}

const VERDICT_CLASS: Record<StrategyBacktest["verdict"], string> = {
    Robust: "pm-bt-verdict-robust",
    Promising: "pm-bt-verdict-promising",
    Fragile: "pm-bt-verdict-fragile",
    Unproven: "pm-bt-verdict-unproven",
};

const STATUS_CLASS: Record<PromotionStatus, string> = {
    done: "is-done",
    active: "is-active",
    pending: "is-pending",
};

function formatPct(n: number, digits = 1): string {
    return `${n.toFixed(digits)}%`;
}

function formatSignedPct(n: number): string {
    if (n === 0) return "0.0%";
    const sign = n > 0 ? "+" : "−";
    return `${sign}${Math.abs(n).toFixed(1)}%`;
}

function formatUsd(n: number): string {
    if (Math.abs(n) >= 1_000_000) {
        return `$${(n / 1_000_000).toFixed(2)}M`;
    }
    if (Math.abs(n) >= 1_000) {
        return `$${(n / 1_000).toFixed(1)}k`;
    }
    return `$${n.toFixed(0)}`;
}

export function BacktestPanel({ strategy }: BacktestPanelProps) {
    const { backtest } = strategy;

    return (
        <div className="pm-bt-panel pm-card">
            <BacktestHead windowLabel={backtest.windowLabel} verdict={backtest.verdict} />
            <div className="pm-bt-chart">
                <AreaChart
                    data={backtest.equityCurve}
                    range="ALL"
                    height={200}
                    showEndDot
                    ariaLabel={`Equity curve for ${strategy.name} over ${backtest.windowLabel}`}
                />
            </div>
            <StatsGrid stats={backtest.stats} />
            <MonteCarloStrip cells={backtest.monteCarlo} />
            <PromotionLadder steps={backtest.promotion} />
        </div>
    );
}

// --------------------------------------------------------------------- //
// Head
// --------------------------------------------------------------------- //

function BacktestHead({
    windowLabel,
    verdict,
}: {
    windowLabel: string;
    verdict: StrategyBacktest["verdict"];
}) {
    return (
        <header className="pm-bt-head">
            <div className="pm-bt-head-main">
                <span className="pm-bt-eyebrow">Backtest</span>
                <span className="pm-bt-window">{windowLabel}</span>
            </div>
            <span className={`pm-bt-verdict ${VERDICT_CLASS[verdict]}`}>{verdict}</span>
        </header>
    );
}

// --------------------------------------------------------------------- //
// Stats grid
// --------------------------------------------------------------------- //

function StatsGrid({ stats }: { stats: BacktestStats }) {
    const cagrTone = stats.cagrPct > 0 ? "pm-num-pos" : stats.cagrPct < 0 ? "pm-num-neg" : "";
    const netTone = stats.netProfitUsd > 0 ? "pm-num-pos" : stats.netProfitUsd < 0 ? "pm-num-neg" : "";
    const ddTone = stats.maxDrawdownPct < 0 ? "pm-num-neg" : "";
    return (
        <div className="pm-bt-grid" role="list" aria-label="Backtest stats">
            <StatCell label="CAGR" value={formatSignedPct(stats.cagrPct)} tone={cagrTone} />
            <StatCell label="Net profit" value={formatUsd(stats.netProfitUsd)} tone={netTone} />
            <StatCell label="Sharpe" value={stats.sharpe.toFixed(2)} />
            <StatCell label="Sortino" value={stats.sortino.toFixed(2)} />
            <StatCell label="Max DD" value={formatPct(stats.maxDrawdownPct, 1)} tone={ddTone} />
            <StatCell label="Profit factor" value={stats.profitFactor.toFixed(2)} />
            <StatCell label="Trades" value={stats.tradeCount.toLocaleString()} />
            <StatCell label="Win rate" value={formatPct(stats.winRatePct, 1)} />
        </div>
    );
}

function StatCell({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: string;
}) {
    return (
        <div className="pm-bt-stat" role="listitem">
            <span className="pm-bt-stat-label">{label}</span>
            <span className={`pm-bt-stat-value num${tone ? ` ${tone}` : ""}`}>{value}</span>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Monte Carlo strip
// --------------------------------------------------------------------- //

function MonteCarloStrip({ cells }: { cells: MonteCarloCell[] }) {
    return (
        <section className="pm-bt-mc" aria-label="Monte Carlo percentiles">
            <header className="pm-bt-mc-head">
                <span className="pm-bt-eyebrow">Monte Carlo</span>
                <span className="pm-bt-mc-hint">Terminal multiplier · implied CAGR</span>
            </header>
            <div className="pm-bt-mc-row">
                {cells.map((c) => {
                    const isMedian = c.percentile === 50;
                    const cagrTone =
                        c.cagrPct > 0 ? "pm-num-pos" : c.cagrPct < 0 ? "pm-num-neg" : "";
                    return (
                        <div
                            key={c.percentile}
                            className={`pm-bt-mc-cell${isMedian ? " is-median" : ""}`}
                            aria-label={`${c.percentile}th percentile: ${c.value.toFixed(2)}x, ${c.cagrPct.toFixed(1)}% CAGR`}
                        >
                            <span className="pm-bt-mc-pct">P{c.percentile}</span>
                            <span className="pm-bt-mc-val num">{c.value.toFixed(2)}×</span>
                            <span className={`pm-bt-mc-cagr num ${cagrTone}`}>
                                {formatSignedPct(c.cagrPct)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

// --------------------------------------------------------------------- //
// Promotion ladder
// --------------------------------------------------------------------- //

function PromotionLadder({ steps }: { steps: PromotionStep[] }) {
    return (
        <section className="pm-bt-promo" aria-label="Promotion ladder">
            <header className="pm-bt-promo-head">
                <span className="pm-bt-eyebrow">Promotion</span>
            </header>
            <ol className="pm-bt-promo-list" role="list">
                {steps.map((step, i) => {
                    const isLast = i === steps.length - 1;
                    return (
                        <li
                            key={step.key}
                            className={`pm-bt-promo-step ${STATUS_CLASS[step.status]}`}
                            aria-current={step.status === "active" ? "step" : undefined}
                        >
                            <span className="pm-bt-promo-dot" aria-hidden="true">
                                {step.status === "done" ? (
                                    <Check className="pm-bt-promo-check" strokeWidth={3} />
                                ) : (
                                    <span className="pm-bt-promo-num">{i + 1}</span>
                                )}
                            </span>
                            <span className="pm-bt-promo-label">{step.label}</span>
                            {!isLast && <span className="pm-bt-promo-line" aria-hidden="true" />}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}
