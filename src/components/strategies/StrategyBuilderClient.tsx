"use client";

import { useCallback, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { usePageHeader } from "@/components/layout/PageHeaderContext";
import { SampleDataNotice } from "@/components/data-display/SampleDataNotice";
import { SampleEmptyState } from "@/components/data-display/SampleEmptyState";
import { useShowSampleData } from "@/lib/hooks/useShowSampleData";
import { SEED_STRATEGIES } from "@/lib/strategies/seed";
import { resolveSelectedStrategyId } from "@/lib/strategies/routes";
import {
    addRule,
    duplicateStrategy,
    hasUnbacktestedChanges,
    removeRule,
    setConjunction,
    setGuardrail,
    toggleUniverseFilter,
    type Strategy,
    type StrategyConjunction,
    type StrategyGuardrails,
    type StrategyRule,
} from "@/lib/strategies/strategy";
import type { AdherenceRule } from "@/lib/adherence/rules";
import {
    SEED_ADHERENCE_RULES,
    SEED_THESIS_TO_STRATEGY,
} from "@/lib/adherence/seed";
import {
    rollingAdherenceScore,
    adherenceTier,
} from "@/lib/adherence/impact";
import { SEED_JOURNAL } from "@/lib/journal/seed";
import { StrategyCard } from "./StrategyCard";
import { RuleBuilderPanel } from "./RuleBuilderPanel";
import { BacktestPanel } from "./BacktestPanel";
import { AdherenceRulesPanel } from "./AdherenceRulesPanel";
import { AdherenceImpactCard } from "./AdherenceImpactCard";

/**
 * Phase 6 (AR-80/81/82) Strategy Builder client.
 *
 * Owns the editable strategies array and the currently-selected strategy
 * id. Renders:
 *   1. The selection row — 3 cards side by side. Clicking switches which
 *      strategy the builder surface below reflects.
 *   2. The 64/36 split — rule builder + universe + guardrails + AR-111
 *      adherence rules on the left (AR-81 + AR-111); backtest equity
 *      curve + stats + monte carlo percentiles + promotion ladder on the
 *      right (AR-82).
 *
 * All state is local — edits live for as long as the tab is open. When
 * we persist strategies to the backend this lifts to either a URL param
 * (draft per strategy) or a server mutation that round-trips through the
 * same reducer helpers.
 *
 * Note: editing rules/universe/guardrails does NOT recompute the
 * backtest — that's what the "Run backtest" action in the topbar will
 * drive once the backtest engine lands. For now the panel always
 * reflects the seed backtest bundle, which is stable per strategy.
 *
 * AR-111 adherence rules live in their own keyed-by-strategy-id map so
 * the seven-rule palette stays independent of the entry-signal rules —
 * different concept, different vocabulary. Seed map comes from
 * `SEED_ADHERENCE_RULES`; strategies not in the map start with an
 * empty list. The rolling 30-day adherence score rendered in the panel
 * header is computed from `SEED_JOURNAL` — once the journal is wired to
 * the store, swap to `useJournalStore.getState().entries` and the tier
 * follows for free.
 */

export function StrategyBuilderClient({ initialStrategyId }: { initialStrategyId?: string } = {}) {
    const [strategies, setStrategies] = useState<Strategy[]>(SEED_STRATEGIES);
    const [selectedId, setSelectedId] = useState<string>(
        () => resolveSelectedStrategyId(initialStrategyId, SEED_STRATEGIES),
    );

    // AR-111. Per-strategy adherence rules. Seeded from the hardcoded
    // palette so every strategy shows meaningful rows on first render;
    // falls back to [] for any strategy not in the seed map.
    const [adherenceByStrategy, setAdherenceByStrategy] = useState<
        Record<string, AdherenceRule[]>
    >(() => {
        const initial: Record<string, AdherenceRule[]> = {};
        for (const s of SEED_STRATEGIES) {
            initial[s.id] = SEED_ADHERENCE_RULES[s.id] ?? [];
        }
        return initial;
    });

    const selected = useMemo(
        () => strategies.find((s) => s.id === selectedId) ?? strategies[0],
        [strategies, selectedId],
    );

    // The rules each backtest was run against. Editing rules has no
    // backtest engine behind it yet, so the panel flags stale results
    // instead of presenting them as current.
    const [backtestedById, setBacktestedById] = useState<Record<string, Strategy>>(() =>
        Object.fromEntries(SEED_STRATEGIES.map((s) => [s.id, s])),
    );
    const backtestStale = selected
        ? hasUnbacktestedChanges(selected, backtestedById[selected.id] ?? selected)
        : false;

    const onDuplicate = useCallback(() => {
        if (!selected) return;
        const copy = duplicateStrategy(selected, strategies);
        setStrategies((prev) => [...prev, copy]);
        setBacktestedById((prev) => ({ ...prev, [copy.id]: backtestedById[selected.id] ?? selected }));
        setAdherenceByStrategy((prev) => ({ ...prev, [copy.id]: prev[selected.id] ?? [] }));
        setSelectedId(copy.id);
    }, [selected, strategies, backtestedById]);

    const headerActions = useMemo(
        () => (
            <button type="button" className="pm-btn pm-btn-ghost pm-strategy-dup-btn" onClick={onDuplicate}>
                <Copy size={14} aria-hidden="true" />
                <span>Duplicate</span>
            </button>
        ),
        [onDuplicate],
    );
    usePageHeader({
        title: "Strategies",
        subtitle: "Write entry rules, backtest them, and hold your orders to them",
        crumbs: ["Strategies", selected?.name ?? "Builder"],
        actions: headerActions,
    });
    const showSample = useShowSampleData();

    const selectedAdherenceRules = selected
        ? adherenceByStrategy[selected.id] ?? []
        : [];

    // Rolling 30-day score for the selected strategy — `null` when the
    // window has no journal entries for this strategy (header shows no
    // badge rather than a misleading "100/100").
    const rollingScore = useMemo(() => {
        if (!selected) return null;
        return rollingAdherenceScore(
            SEED_JOURNAL,
            selected.id,
            SEED_THESIS_TO_STRATEGY,
        );
    }, [selected]);
    const rollingTier = useMemo(
        () => adherenceTier(rollingScore),
        [rollingScore],
    );

    // Per-card rolling score so the row cards show their own adherence
    // tier at a glance, not just the currently-selected strategy. Pure
    // derivation — cheap, and keyed on the stable seed journal.
    const scoreByStrategy = useMemo(() => {
        const map: Record<string, number | null> = {};
        for (const s of strategies) {
            map[s.id] = rollingAdherenceScore(
                SEED_JOURNAL,
                s.id,
                SEED_THESIS_TO_STRATEGY,
            );
        }
        return map;
    }, [strategies]);

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

    const onChangeAdherenceRules = useCallback(
        (next: AdherenceRule[]) => {
            if (!selectedId) return;
            setAdherenceByStrategy((prev) => ({
                ...prev,
                [selectedId]: next,
            }));
        },
        [selectedId],
    );

    if (!showSample) {
        return (
            <div className="pm-strategy-page">
                <SampleEmptyState
                    title="No strategies yet"
                    body="Strategies are rule sets you backtest before trusting them with real orders. The examples are hidden; show them to explore the builder."
                />
            </div>
        );
    }

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
            <SampleDataNotice>
                These strategies and their backtests are examples. Edits stay in this tab until strategies are saved to your account.
            </SampleDataNotice>
            <section className="pm-strategy-row" aria-label="Strategies">
                {strategies.map((s) => (
                    <StrategyCard
                        key={s.id}
                        strategy={s}
                        selected={s.id === selectedId}
                        onSelect={() => setSelectedId(s.id)}
                        adherenceScore={scoreByStrategy[s.id] ?? null}
                        adherenceTier={adherenceTier(scoreByStrategy[s.id] ?? null)}
                    />
                ))}
            </section>

            <section className="pm-strategy-split" aria-label="Builder surface">
                <div className="pm-strategy-left-col">
                    <RuleBuilderPanel
                        strategy={selected}
                        onChangeRule={onChangeRule}
                        onAddRule={onAddRule}
                        onRemoveRule={onRemoveRule}
                        onChangeConjunction={onChangeConjunction}
                        onToggleUniverse={onToggleUniverse}
                        onChangeGuardrail={onChangeGuardrail}
                    />
                    <AdherenceRulesPanel
                        rules={selectedAdherenceRules}
                        onChange={onChangeAdherenceRules}
                        adherenceScore={rollingScore}
                        adherenceTier={rollingTier}
                    />
                </div>
                <BacktestPanel strategy={selected} stale={backtestStale} />
            </section>

            <AdherenceImpactCard entries={SEED_JOURNAL} />
        </div>
    );
}
