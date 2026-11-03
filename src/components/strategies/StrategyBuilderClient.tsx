"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { usePageHeader } from "@/components/layout/PageHeaderContext";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";
import { SampleDataNotice } from "@/components/data-display/SampleDataNotice";
import { SampleEmptyState } from "@/components/data-display/SampleEmptyState";
import { useShowSampleData } from "@/lib/hooks/useShowSampleData";
import { SEED_STRATEGIES } from "@/lib/strategies/seed";
import { resolveSelectedStrategyId } from "@/lib/strategies/routes";
import type { StrategiesPageData } from "@/lib/strategies/server";
import {
    addRule,
    addSymbols,
    DEFAULT_GUARDRAILS,
    duplicateStrategy,
    hasUnbacktestedChanges,
    removeRule,
    removeSymbol,
    setConjunction,
    setGuardrail,
    STRATEGY_LIMITS,
    strategyDefinition,
    type Strategy,
    type StrategyConjunction,
    type StrategyGuardrails,
    type StrategyRule,
} from "@/lib/strategies/strategy";
import type { AdherenceRule } from "@/lib/adherence/rules";
import { SEED_THESIS_TO_STRATEGY } from "@/lib/adherence/seed";
import { rollingAdherenceScore, adherenceTier } from "@/lib/adherence/impact";
import { getSeedJournal, seedJournalAnchorMs } from "@/lib/journal/seed";
import { useRequestTime } from "@/components/providers/RequestTimeProvider";
import { StrategyCard } from "./StrategyCard";
import { RuleBuilderPanel } from "./RuleBuilderPanel";
import { BacktestPanel } from "./BacktestPanel";
import { AdherenceRulesPanel } from "./AdherenceRulesPanel";
import { AdherenceImpactCard } from "./AdherenceImpactCard";

/**
 * Strategy Builder client (AR-80/81/82; saved strategies, launch item i55).
 *
 * Two rows of cards: the user's own strategies, saved to their account,
 * and (with example data on) the examples, labelled Sample. Below them the
 * builder split for the selected one: rules, tickers, guardrails and
 * discipline rules on the left; the backtest on the right.
 *
 * Edits to a saved strategy are saved a moment after the last change, one
 * request at a time per strategy, so a slow save can't land after a newer
 * one. Run backtest saves first, then runs the engine on the server over
 * the stored prices. Edits to an example stay in this tab and flag its
 * illustrative backtest as out of date; Duplicate saves a copy to the
 * account, which can then be backtested for real.
 *
 * Without a database, strategies the user makes stay in this tab and
 * can't be backtested.
 */

type SaveState = "saving" | "saved" | "error";

const SAVE_DELAY_MS = 600;

function toInput(s: Strategy) {
    return { name: s.name, description: s.description, definition: strategyDefinition(s), adherenceRules: s.adherenceRules };
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
    const body = await res.json().catch(() => null);
    return typeof body?.error === "string" ? body.error : fallback;
}

export function StrategyBuilderClient({ data, requestedId }: { data: StrategiesPageData; requestedId?: string }) {
    const { persisted, unavailable } = data;
    const showSample = useShowSampleData();
    const [mine, setMine] = useState<Strategy[]>(data.strategies);
    const [examples, setExamples] = useState<Strategy[]>(SEED_STRATEGIES);
    const [selectedId, setSelectedId] = useState<string>(
        () => resolveSelectedStrategyId(requestedId, [...data.strategies, ...SEED_STRATEGIES]),
    );
    const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
    const [saveError, setSaveError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [running, setRunning] = useState<string | null>(null);
    const [runError, setRunError] = useState<Record<string, string>>({});

    const visible = useMemo(() => [...mine, ...(showSample ? examples : [])], [mine, examples, showSample]);
    const selected = visible.find((s) => s.id === selectedId) ?? visible[0];
    const isMine = Boolean(selected && !selected.example);

    // -- Saving ----------------------------------------------------------
    const pending = useRef(new Map<string, Strategy>());
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const queues = useRef(new Map<string, Promise<boolean>>());

    /** Sends the strategy's latest unsaved version, after any save already on its way. */
    const flush = useCallback((id: string): Promise<boolean> => {
        clearTimeout(timers.current.get(id));
        timers.current.delete(id);
        const previous = queues.current.get(id) ?? Promise.resolve(true);
        const next = previous.then(async () => {
            const strategy = pending.current.get(id);
            if (!strategy) return true;
            pending.current.delete(id);
            setSaveState((prev) => ({ ...prev, [id]: "saving" }));
            try {
                const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(toInput(strategy)),
                });
                if (!res.ok) throw new Error(await errorMessage(res, "Couldn't save the strategy."));
                setSaveState((prev) => ({ ...prev, [id]: "saved" }));
                setSaveError(null);
                return true;
            } catch (err) {
                setSaveState((prev) => ({ ...prev, [id]: "error" }));
                setSaveError(err instanceof Error ? err.message : "Couldn't save the strategy.");
                return false;
            }
        });
        queues.current.set(id, next);
        return next;
    }, []);

    const scheduleSave = useCallback((strategy: Strategy) => {
        pending.current.set(strategy.id, strategy);
        clearTimeout(timers.current.get(strategy.id));
        timers.current.set(strategy.id, setTimeout(() => void flush(strategy.id), SAVE_DELAY_MS));
        setSaveState((prev) => ({ ...prev, [strategy.id]: "saving" }));
    }, [flush]);

    // -- Editing ---------------------------------------------------------
    const updateSelected = useCallback((patch: (s: Strategy) => Strategy) => {
        if (!selected) return;
        const next = patch(selected);
        if (selected.example) {
            setExamples((prev) => prev.map((s) => (s.id === next.id ? next : s)));
            return;
        }
        setMine((prev) => prev.map((s) => (s.id === next.id ? next : s)));
        if (persisted) scheduleSave(next);
    }, [selected, persisted, scheduleSave]);

    const onChangeRule = useCallback((ruleId: string, patch: Partial<StrategyRule>) => {
        updateSelected((s) => ({ ...s, rules: s.rules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)) }));
    }, [updateSelected]);

    const onAddRule = useCallback(() => {
        updateSelected((s) => {
            const next = addRule(s.rules, s.conjunctions, { id: `r${Date.now().toString(36)}`, field: "RSI(14)", op: "<", value: "30" }, "AND");
            return { ...s, rules: next.rules, conjunctions: next.conjunctions };
        });
    }, [updateSelected]);

    const onRemoveRule = useCallback((ruleId: string) => {
        updateSelected((s) => {
            const next = removeRule(s.rules, s.conjunctions, ruleId);
            return { ...s, rules: next.rules, conjunctions: next.conjunctions };
        });
    }, [updateSelected]);

    const onChangeConjunction = useCallback((index: number, next: StrategyConjunction) => {
        updateSelected((s) => ({ ...s, conjunctions: setConjunction(s.conjunctions, index, next) }));
    }, [updateSelected]);

    const onAddSymbols = useCallback((symbols: readonly string[]) => {
        updateSelected((s) => ({ ...s, symbols: addSymbols(s.symbols, symbols) }));
    }, [updateSelected]);

    const onRemoveSymbol = useCallback((symbol: string) => {
        updateSelected((s) => ({ ...s, symbols: removeSymbol(s.symbols, symbol) }));
    }, [updateSelected]);

    const onChangeGuardrail = useCallback(<K extends keyof StrategyGuardrails>(key: K, value: StrategyGuardrails[K]) => {
        updateSelected((s) => ({ ...s, guardrails: setGuardrail(s.guardrails, key, value) }));
    }, [updateSelected]);

    const onRename = useCallback((name: string) => updateSelected((s) => ({ ...s, name })), [updateSelected]);

    const onChangeAdherenceRules = useCallback((next: AdherenceRule[]) => {
        updateSelected((s) => ({ ...s, adherenceRules: next }));
    }, [updateSelected]);

    // -- Create, copy, delete --------------------------------------------
    const addMine = useCallback(async (draft: Strategy) => {
        if (!persisted) {
            setMine((prev) => [...prev, draft]);
            setSelectedId(draft.id);
            return;
        }
        setBusy(true);
        try {
            const res = await fetch("/api/strategies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(toInput(draft)),
            });
            if (!res.ok) throw new Error(await errorMessage(res, "Couldn't save the strategy."));
            const saved = (await res.json()).data as Strategy;
            setMine((prev) => [...prev, saved]);
            setSelectedId(saved.id);
            setSaveError(null);
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Couldn't save the strategy.");
        } finally {
            setBusy(false);
        }
    }, [persisted]);

    const localId = () => `local-${Date.now().toString(36)}`;
    const atLimit = mine.length >= STRATEGY_LIMITS.perUser;

    const onNew = useCallback(() => {
        const names = new Set(mine.map((s) => s.name));
        let name = "New strategy";
        for (let k = 2; names.has(name); k++) name = `New strategy ${k}`;
        void addMine({
            id: localId(),
            name,
            description: "",
            rules: [{ id: "r1", field: "Close", op: ">", value: "SMA(50)" }],
            conjunctions: [],
            symbols: ["SPY"],
            guardrails: DEFAULT_GUARDRAILS,
            adherenceRules: [],
            backtest: null,
        });
    }, [mine, addMine]);

    const onDuplicate = useCallback(() => {
        if (selected) void addMine(duplicateStrategy(selected, visible, localId()));
    }, [selected, visible, addMine]);

    const onDelete = useCallback(async () => {
        if (!selected || selected.example) return;
        const id = selected.id;
        clearTimeout(timers.current.get(id));
        pending.current.delete(id);
        if (persisted) {
            setBusy(true);
            try {
                await queues.current.get(id);
                const res = await fetch(`/api/strategies/${encodeURIComponent(id)}`, { method: "DELETE" });
                if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res, "Couldn't delete the strategy."));
            } catch (err) {
                setSaveError(err instanceof Error ? err.message : "Couldn't delete the strategy.");
                setBusy(false);
                return;
            }
            setBusy(false);
        }
        setMine((prev) => prev.filter((s) => s.id !== id));
        setConfirmDelete(false);
        setSelectedId("");
    }, [selected, persisted]);

    // -- Backtest ----------------------------------------------------------
    const onRun = useCallback(async () => {
        if (!selected || selected.example) return;
        const id = selected.id;
        setRunning(id);
        setRunError((prev) => ({ ...prev, [id]: "" }));
        try {
            if (!(await flush(id))) throw new Error("Save the strategy before backtesting it.");
            const res = await fetch(`/api/strategies/${encodeURIComponent(id)}/backtest`, { method: "POST" });
            if (!res.ok) throw new Error(await errorMessage(res, "Couldn't run the backtest."));
            const saved = (await res.json()).data as Strategy;
            setMine((prev) => prev.map((s) => (s.id === id ? { ...s, backtest: saved.backtest } : s)));
        } catch (err) {
            setRunError((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : "Couldn't run the backtest." }));
        } finally {
            setRunning(null);
        }
    }, [selected, flush]);

    // -- Header ------------------------------------------------------------
    const status = selected && isMine && persisted ? saveState[selected.id] : undefined;
    const headerActions = useMemo(
        () => (
            <>
                {status && (
                    <span className="pm-strategy-save-state" role="status" data-testid="strategy-save-state">
                        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "Not saved"}
                    </span>
                )}
                <button type="button" className="pm-btn pm-btn-ghost" onClick={onNew} disabled={busy || atLimit || unavailable}>
                    <Plus size={14} aria-hidden="true" />
                    <span>New strategy</span>
                </button>
                {selected && (
                    <button
                        type="button"
                        className="pm-btn pm-btn-ghost pm-strategy-dup-btn"
                        onClick={onDuplicate}
                        disabled={busy || atLimit || unavailable}
                    >
                        <Copy size={14} aria-hidden="true" />
                        <span>Duplicate</span>
                    </button>
                )}
                {isMine && (
                    <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
                        <Trash2 size={14} aria-hidden="true" />
                        <span>Delete</span>
                    </button>
                )}
            </>
        ),
        [status, onNew, onDuplicate, busy, atLimit, unavailable, selected, isMine],
    );
    usePageHeader({
        title: "Strategies",
        subtitle: "Write entry rules, backtest them, and hold your orders to them",
        crumbs: ["Strategies", selected?.name || "Builder"],
        actions: headerActions,
    });

    // -- Example journal (AR-111) ----------------------------------------
    // The example journal and its 30-day windows share one anchor: the
    // start of the UTC day of the server's request time, so server and
    // client agree.
    const journalAnchorMs = seedJournalAnchorMs(useRequestTime());
    const seedJournal = getSeedJournal(journalAnchorMs);
    const scoreByExample = useMemo(() => {
        const map: Record<string, number | null> = {};
        for (const s of examples) {
            map[s.id] = rollingAdherenceScore(seedJournal, s.id, SEED_THESIS_TO_STRATEGY, 30, journalAnchorMs);
        }
        return map;
    }, [examples, seedJournal, journalAnchorMs]);

    const backtestStale = Boolean(selected?.backtest && hasUnbacktestedChanges(selected, selected.backtest.definition));
    const exampleScore = selected?.example ? scoreByExample[selected.id] ?? null : null;

    return (
        <div className="pm-strategy-page">
            {unavailable && <DataUnavailableNotice what="your strategies" />}
            {saveError && <p className="pm-strategy-error" role="alert" data-testid="strategy-error">{saveError}</p>}
            {confirmDelete && selected && isMine && (
                <div className="pm-strategy-confirm" role="alertdialog" aria-label="Delete strategy">
                    <span>Delete “{selected.name}” and its backtest?</span>
                    <button type="button" className="pm-btn pm-btn-danger" onClick={() => void onDelete()} disabled={busy}>Delete</button>
                    <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </div>
            )}

            <section className="pm-strategy-group" aria-label="Your strategies">
                <h2 className="pm-strategy-group-title">Your strategies</h2>
                {mine.length === 0 && !showSample ? (
                    <SampleEmptyState
                        title="No strategies yet"
                        body="Start one with New strategy, or show the examples to explore the builder and save a copy of one."
                    />
                ) : mine.length === 0 ? (
                    <p className="pm-strategy-group-empty" data-testid="strategies-empty">
                        {persisted
                            ? "None yet. Start a new strategy, or duplicate an example to make it yours and backtest it on stored prices."
                            : "None yet. Without a database, strategies you make stay in this tab and can't be backtested."}
                    </p>
                ) : (
                    <div className="pm-strategy-row" data-testid="my-strategies">
                        {mine.map((s) => (
                            <StrategyCard key={s.id} strategy={s} selected={s.id === selected?.id} onSelect={() => setSelectedId(s.id)} />
                        ))}
                    </div>
                )}
            </section>

            {showSample && (
                <section className="pm-strategy-group" aria-label="Example strategies">
                    <h2 className="pm-strategy-group-title">Examples</h2>
                    <SampleDataNotice>
                        These strategies and their backtests are examples. Edits stay in this tab; duplicate one to save it to your account and backtest it.
                    </SampleDataNotice>
                    <div className="pm-strategy-row" data-testid="example-strategies">
                        {examples.map((s) => (
                            <StrategyCard
                                key={s.id}
                                strategy={s}
                                selected={s.id === selected?.id}
                                onSelect={() => setSelectedId(s.id)}
                                adherenceScore={scoreByExample[s.id] ?? null}
                                adherenceTier={adherenceTier(scoreByExample[s.id] ?? null)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {selected && (
                <section className="pm-strategy-split" aria-label="Builder surface">
                    <div className="pm-strategy-left-col">
                        <RuleBuilderPanel
                            strategy={selected}
                            onChangeRule={onChangeRule}
                            onAddRule={onAddRule}
                            onRemoveRule={onRemoveRule}
                            onChangeConjunction={onChangeConjunction}
                            onAddSymbols={onAddSymbols}
                            onRemoveSymbol={onRemoveSymbol}
                            onChangeGuardrail={onChangeGuardrail}
                            onRename={isMine ? onRename : undefined}
                        />
                        <AdherenceRulesPanel
                            rules={selected.adherenceRules}
                            onChange={onChangeAdherenceRules}
                            adherenceScore={exampleScore}
                            adherenceTier={adherenceTier(exampleScore)}
                            note={isMine ? "Saved with this strategy. Trade checks the examples' rules for now: a thesis can't name a strategy of yours yet." : undefined}
                        />
                    </div>
                    <BacktestPanel
                        strategy={selected}
                        stale={backtestStale}
                        onRun={isMine && persisted ? () => void onRun() : undefined}
                        running={running === selected.id}
                        error={runError[selected.id] || null}
                    />
                </section>
            )}

            {showSample && <AdherenceImpactCard entries={seedJournal} />}
        </div>
    );
}
