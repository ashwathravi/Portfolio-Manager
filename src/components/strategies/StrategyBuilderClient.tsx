"use client";

import { useCallback, useMemo, useState } from "react";
import { SEED_STRATEGIES } from "@/lib/strategies/seed";
import {
    addRule,
    removeRule,
    setConjunction,
    setGuardrail,
    toggleUniverseFilter,
    type Strategy,
    type StrategyConjunction,
    type StrategyGuardrails,
    type StrategyRule,
} from "@/lib/strategies/strategy";
import { StrategyCard } from "./StrategyCard";
import { RuleBuilderPanel } from "./RuleBuilderPanel";

/**
 * Phase 6 (AR-80/81) Strategy Builder client.
 *
 * Owns the editable strategies array and the currently-selected strategy
 * id. Renders:
 *   1. The selection row — 3 cards side by side. Clicking switches which
 *      strategy the builder surface below reflects.
 *   2. The 64/36 split — rule builder + universe + guardrails on the
 *      left (AR-81), backtest + monte carlo + promotion ladder on the
 *      right (AR-82 placeholder until that ticket lands).
 *
 * All state is local — edits live for as long as the tab is open. When
 * we persist strategies to the backend this lifts to either a URL param
 * (draft per strategy) or a server mutation that round-trips through the
 * same reducer helpers.
 */

export function StrategyBuilderClient() {
    const [strategies, setStrategies] = useState<Strategy[]>(SEED_STRATEGIES);
    const [selectedId, setSelectedId] = useState<string>(strategies[0]?.id ?? "");

    const selected = useMemo(
        () => strategies.find((s) => s.id === selectedId) ?? strategies[0],
        [strategies, selectedId],
    );

    // -- Rule/conjunction/universe/guardrail mutators ------------------
    const updateSelected = useCallback(
        (patch: (s: Strategy) => Strategy) => {
            setStrategies((prev) =>
                prev.map((s) => (s.id === selectedId ? patch(s) : s)),
            );
        },
        [selectedId],
    );

    const onChangeRule = useCallback(
        (ruleId: string, patch: Partial<StrategyRule>) => {
            updateSelected((s) => ({
                ...s,
                rules: s.rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)),
            }));
        },
        [updateSelected],
    );

    const onAddRule = useCallback(() => {
        updateSelected((s) => {
            const nextId = `rule-${s.id}-${Date.now().toString(36)}`;
            const nextRule: StrategyRule = {
                id: nextId,
                field: "P/E",
                op: "<",
                value: "20",
            };
            const next = addRule(s.rules, s.conjunctions, nextRule, "AND");
            return { ...s, rules: next.rules, conjunctions: next.conjunctions };
        });
    }, [updateSelected]);

    const onRemoveRule = useCallback(
        (ruleId: string) => {
            updateSelected((s) => {
                const next = removeRule(s.rules, s.conjunctions, ruleId);
                return { ...s, rules: next.rules, conjunctions: next.conjunctions };
            });
        },
        [updateSelected],
    );

    const onChangeConjunction = useCallback(
        (index: number, next: StrategyConjunction) => {
            updateSelected((s) => ({
                ...s,
                conjunctions: setConjunction(s.conjunctions, index, next),
            }));
        },
        [updateSelected],
    );

    const onToggleUniverse = useCallback(
        (filterId: string) => {
            updateSelected((s) => ({
                ...s,
                universe: toggleUniverseFilter(s.universe, filterId),
            }));
        },
        [updateSelected],
    );

    const onChangeGuardrail = useCallback(
        <K extends keyof StrategyGuardrails>(key: K, value: StrategyGuardrails[K]) => {
            updateSelected((s) => ({
                ...s,
                guardrails: setGuardrail(s.guardrails, key, value),
            }));
        },
        [updateSelected],
    );

    if (!selected) {
        return (
            <div className="pm-strategy-page">
                <div className="pm-card" style={{ padding: 24 }}>
                    No strategies available.
                </div>
            </div>
        );
    }

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
                <RuleBuilderPanel
                    strategy={selected}
                    onChangeRule={onChangeRule}
                    onAddRule={onAddRule}
                    onRemoveRule={onRemoveRule}
                    onChangeConjunction={onChangeConjunction}
                    onToggleUniverse={onToggleUniverse}
                    onChangeGuardrail={onChangeGuardrail}
                />
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
