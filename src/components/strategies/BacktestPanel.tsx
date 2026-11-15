"use client";

import { Check, Play } from "lucide-react";
import { AreaChart } from "@/components/charts/AreaChart";
import {
    backtestWindowLabel,
    type BacktestStats,
    type MonteCarloCell,
    type PromotionStatus,
    type PromotionStep,
    type Strategy,
    type StrategyBacktest,
} from "@/lib/strategies/strategy";

/**
 * Backtest · Monte Carlo · Promotion (AR-82).
 *
 * The right column of the builder split:
 *
 *   1. HEAD — window, the verdict pill and the reason for it, and for a
 *      saved strategy the Run backtest button.
 *   2. EQUITY CURVE over the window, then SPY over the same window.
 *   3. STATS GRID — return (CAGR from a year on), net profit, Sharpe,
 *      Sortino, max drawdown, profit factor, trades, win rate.
 *   4. MONTE CARLO — the ending multiple at five percentiles of resampled
 *      daily returns.
 *   5. PROMOTION LADDER — the examples only: Atlas has no paper trading
 *      for a saved strategy to move on to.
 *
 * A saved strategy's numbers come from the backtest engine over the price
 * store (launch item i55); the examples' are illustrative.
 */

export interface BacktestPanelProps {
    strategy: Strategy;
    /** True when rules changed after the backtest ran. */
    stale?: boolean;
    /** Runs the backtest; absent where it can't run (an example, or no database). */
    onRun?: () => void;
    running?: boolean;
    /** Why the last run couldn't start (no rules, no history...). */
    error?: string | null;
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
    const sign = n < 0 ? "−" : "";
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
    return `${sign}$${abs.toFixed(0)}`;
}

const DASH = "—";
const fixed = (n: number | null, digits = 2) => (n === null ? DASH : n.toFixed(digits));

export function BacktestPanel({ strategy, stale = false, onRun, running = false, error = null }: BacktestPanelProps) {
    const { backtest } = strategy;

    return (
        <div className="pm-bt-panel pm-card" data-testid="backtest-panel">
            <header className="pm-bt-head">
                <div className="pm-bt-head-main">
                    <span className="pm-bt-eyebrow">Backtest</span>
                    <span className="pm-bt-window" data-testid="backtest-window">
                        {backtest ? backtestWindowLabel(backtest.from, backtest.to) : "Not run yet"}
                    </span>
                </div>
                {backtest && (
                    <span className={`pm-bt-verdict ${VERDICT_CLASS[backtest.verdict]}`} data-testid="backtest-verdict">
                        {backtest.verdict}
                    </span>
                )}
                {onRun && (
                    <button type="button" className="pm-btn pm-btn-ghost pm-bt-run" onClick={onRun} disabled={running}>
                        <Play size={13} aria-hidden="true" />
                        <span>{running ? "Running…" : "Run backtest"}</span>
                    </button>
                )}
            </header>
            {error && <p className="pm-bt-error" role="alert" data-testid="backtest-error">{error}</p>}
            {stale && backtest && (
                <p className="pm-bt-stale" role="status" data-testid="backtest-stale">
                    Rules changed since this backtest. The results below are for the rules it ran on.
                </p>
            )}
            {!backtest ? (
                <p className="pm-bt-empty" data-testid="backtest-empty">
                    {onRun
                        ? "Run the backtest to see how these rules would have traded over the prices Atlas has stored (up to two years of daily closes)."
                        : "Backtests run on strategies saved to your account."}
                </p>
            ) : (
                <BacktestResults strategy={strategy} backtest={backtest} />
            )}
        </div>
    );
}

function BacktestResults({ strategy, backtest }: { strategy: Strategy; backtest: StrategyBacktest }) {
    const windowLabel = backtestWindowLabel(backtest.from, backtest.to);
    const missing = backtest.symbolsWithoutHistory;
    return (
        <>
            <p className="pm-bt-reason" data-testid="backtest-reason">{backtest.verdictReason}</p>
            <div className="pm-bt-chart">
                <AreaChart
                    data={backtest.equityCurve}
                    range="ALL"
                    // The panel is ~360px wide; a matching viewBox keeps the
                    // 11-unit axis labels at a readable ~11px.
                    width={360}
                    height={170}
                    showEndDot
                    ariaLabel={`Equity curve for ${strategy.name} over ${windowLabel}`}
                />
            </div>
            {backtest.benchmark && (
                <p className="pm-bt-benchmark" data-testid="backtest-benchmark">
                    {backtest.benchmark.symbol} over the same window:{" "}
                    <span className="num">{formatSignedPct(backtest.benchmark.totalReturnPct)}</span>
                </p>
            )}
            <StatsGrid stats={backtest.stats} />
            {backtest.monteCarlo && <MonteCarloStrip cells={backtest.monteCarlo} />}
            {backtest.promotion && <PromotionLadder steps={backtest.promotion} />}
            {missing.length > 0 && (
                <p className="pm-bt-note" data-testid="backtest-missing">
                    Left out, without stored prices yet: {missing.join(", ")}. Their history arrives over the next few nights.
                </p>
            )}
            <p className="pm-bt-note" data-testid="backtest-assumptions">
                Long only, from $100,000. Signals at a close trade at the next open; no fees, slippage, dividends or taxes.
                Past results don&apos;t predict future returns, and none of this is investment advice.
                {backtest.ranAt && <> Ran {new Date(backtest.ranAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.</>}
            </p>
        </>
    );
}

// --------------------------------------------------------------------- //
// Stats grid
// --------------------------------------------------------------------- //

function StatsGrid({ stats }: { stats: BacktestStats }) {
    const tone = (n: number | null) => (n === null || n === 0 ? "" : n > 0 ? "pm-num-pos" : "pm-num-neg");
    const annual = stats.cagrPct !== null;
    return (
        <div className="pm-bt-grid" role="list" aria-label="Backtest stats">
            <StatCell
                label={annual ? "CAGR" : "Return"}
                value={formatSignedPct(annual ? stats.cagrPct! : stats.totalReturnPct)}
                tone={tone(annual ? stats.cagrPct : stats.totalReturnPct)}
            />
            <StatCell label="Net profit" value={formatUsd(stats.netProfitUsd)} tone={tone(stats.netProfitUsd)} />
            <StatCell label="Sharpe" value={fixed(stats.sharpe)} />
            <StatCell label="Sortino" value={fixed(stats.sortino)} />
            <StatCell label="Max DD" value={formatPct(stats.maxDrawdownPct, 1)} tone={stats.maxDrawdownPct < 0 ? "pm-num-neg" : ""} />
            <StatCell label="Profit factor" value={fixed(stats.profitFactor)} />
            <StatCell label="Trades" value={stats.tradeCount.toLocaleString("en-US")} />
            <StatCell label="Win rate" value={stats.winRatePct === null ? DASH : formatPct(stats.winRatePct, 1)} />
        </div>
    );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
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
    const highFirst = [...cells].sort((a, b) => b.percentile - a.percentile);
    return (
        <section className="pm-bt-mc" aria-label="Monte Carlo percentiles">
            <header className="pm-bt-mc-head">
                <span className="pm-bt-eyebrow">Monte Carlo</span>
                <span className="pm-bt-mc-hint">Daily returns resampled · ending multiple</span>
            </header>
            <div className="pm-bt-mc-row">
                {highFirst.map((c) => {
                    const change = (c.value - 1) * 100;
                    const changeTone = change > 0 ? "pm-num-pos" : change < 0 ? "pm-num-neg" : "";
                    return (
                        <div
                            key={c.percentile}
                            className={`pm-bt-mc-cell${c.percentile === 50 ? " is-median" : ""}`}
                            aria-label={`${c.percentile}th percentile: ${c.value.toFixed(2)}x, ${formatSignedPct(change)}`}
                        >
                            <span className="pm-bt-mc-pct">P{c.percentile}</span>
                            <span className="pm-bt-mc-val num">{c.value.toFixed(2)}×</span>
                            <span className={`pm-bt-mc-cagr num ${changeTone}`}>{formatSignedPct(change)}</span>
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
