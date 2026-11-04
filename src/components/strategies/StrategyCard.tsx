"use client";

import { summarizeRules, type Strategy } from "@/lib/strategies/strategy";

/**
 * Strategy selection card (AR-80).
 *
 * Purely presentational — parent owns which strategy is selected and passes
 * the `selected` flag in. Each card shows:
 *   - the strategy's name, its rule and ticker counts
 *   - its last backtest's return, or that it hasn't been backtested
 *     (never a zero standing in for a result that doesn't exist)
 *   - for the examples, a rolling 30-day adherence score (AR-111) from
 *     the example journal
 *
 * The selected card gets an accent border + ambient shadow so the user
 * always knows which strategy the rule builder + backtest surface below
 * is currently reflecting.
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

function formatSignedPct(pct: number): string {
    if (pct === 0) return "0.00%";
    const sign = pct > 0 ? "+" : "−";
    return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function StrategyCard({
    strategy,
    selected = false,
    onSelect,
    adherenceScore = null,
    adherenceTier = null,
}: StrategyCardProps) {
    const totalReturn = strategy.backtest?.stats.totalReturnPct ?? null;
    const returnTone = totalReturn === null || totalReturn === 0 ? "" : totalReturn > 0 ? "pm-num-pos" : "pm-num-neg";
    const tickers = strategy.symbols.length;

    return (
        <button
            type="button"
            className={`pm-strategy-card${selected ? " is-selected" : ""}`}
            aria-pressed={selected}
            onClick={onSelect}
            title={strategy.description || undefined}
        >
            <span className="pm-strategy-card-top">
                <span className="pm-strategy-shortid">
                    {summarizeRules(strategy)} · {tickers} ticker{tickers === 1 ? "" : "s"}
                </span>
            </span>
            <span className="pm-strategy-name">{strategy.name}</span>
            <span className="pm-strategy-card-meta">
                {totalReturn === null ? (
                    <span className="pm-strategy-return pm-strategy-return-none" data-testid="strategy-card-return">
                        Not backtested
                    </span>
                ) : (
                    <span className={`pm-strategy-return num ${returnTone}`} aria-label="Backtest return" data-testid="strategy-card-return">
                        {formatSignedPct(totalReturn)}
                    </span>
                )}
                {adherenceScore != null && (
                    <span
                        className="pm-strategy-adherence"
                        data-tier={adherenceTier ?? 'none'}
                        data-testid="strategy-card-adherence"
                        aria-label={`30-day adherence ${adherenceScore} of 100`}
                        title="Rolling 30-day rule adherence"
                    >
                        <span className="pm-strategy-adherence-label">30d adherence</span>
                        <span className="pm-strategy-adherence-value num">
                            {adherenceScore}
                            <span className="pm-strategy-adherence-max">/ 100</span>
                        </span>
                    </span>
                )}
            </span>
        </button>
    );
}
