"use client";

import { useState } from "react";
import { SEED_STRATEGIES } from "@/lib/strategies/seed";
import type { Strategy } from "@/lib/strategies/strategy";
import { StrategyCard } from "./StrategyCard";

/**
 * Phase 6 (AR-80) Strategy Builder client.
 *
 * Owns the currently-selected strategy id and renders:
 *   1. The selection row — 3 cards side by side. Clicking switches which
 *      strategy the builder surface below reflects.
 *   2. A 64/36 split placeholder row that AR-81 (rule builder + universe
 *      + guardrails) and AR-82 (backtest + Monte Carlo + promotion) will
 *      fill in.
 *
 * Kept stateful rather than URL-driven because the Phase 6 scope is a
 * single-screen builder — selection lives for as long as the tab is open.
 * When we persist strategies to the backend we'll lift this into a URL
 * param (`?strategy=S-001`) so drafts survive a refresh.
 */

export function StrategyBuilderClient() {
    const strategies: Strategy[] = SEED_STRATEGIES;
    const [selectedId, setSelectedId] = useState<string>(strategies[0]?.id ?? "");

    return (
        <div className="pm-strategy-page">
            <section className="pm-strategy-row" aria-label="Strategies">
                {strategies.map((s) => (
                    <StrategyCard
                        key={s.id}
                        strategy={s}
                        selected={s.id === selectedId}
                        onSelect={() => setSelectedId(s.id)}
                    />
                ))}
            </section>

            <section className="pm-strategy-split" aria-label="Builder surface">
                <div className="pm-strategy-builder-placeholder pm-card">
                    <header className="pm-strategy-placeholder-head">
                        <span className="pm-strategy-placeholder-eyebrow">Rules · Universe · Guardrails</span>
                        <span className="pm-strategy-placeholder-hint">AR-81</span>
                    </header>
                    <p className="pm-strategy-placeholder-body">
                        Rule builder, universe filters, and guardrail sliders land here next.
                        Compose AND/OR conditions, scope the universe, and cap position size,
                        stop loss, and rebalance cadence before running a backtest.
                    </p>
                </div>
                <div className="pm-strategy-backtest-placeholder pm-card">
                    <header className="pm-strategy-placeholder-head">
                        <span className="pm-strategy-placeholder-eyebrow">Backtest · Monte Carlo · Promotion</span>
                        <span className="pm-strategy-placeholder-hint">AR-82</span>
                    </header>
                    <p className="pm-strategy-placeholder-body">
                        Equity curve, stats grid, percentile strip, and the rules →
                        backtest → robustness → paper → live promotion ladder land here
                        next.
                    </p>
                </div>
            </section>
        </div>
    );
}
