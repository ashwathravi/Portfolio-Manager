"use client";

import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
    evaluateSellDiscipline,
    reactivateSellDisciplineRule,
    resolveSellDisciplineRule,
    SELL_DISCIPLINE_ACTION_LABELS,
    SELL_DISCIPLINE_TRIGGER_LABELS,
    SELL_DISCIPLINE_TRIGGER_TYPES,
    snoozeSellDisciplineRule,
    type SellDisciplineAction,
    type SellDisciplineRule,
    type SellDisciplineTriggerType,
} from "@/lib/risk-policy";
import { mockPortfolios } from "@/lib/mockData";
import { DEFAULT_THESES } from "@/lib/research/thesis";
import { useSettingsStore } from "@/lib/stores/settingsStore";

const ACTION_OPTIONS: SellDisciplineAction[] = [
    "trim",
    "recover_cost",
    "re_underwrite",
    "exit",
    "no_add",
    "review",
];

const SAMPLE_HOLDINGS = (mockPortfolios[0]?.holdings ?? []).map((holding) => ({
    id: holding.id,
    symbol: holding.ticker,
    name: holding.name,
    quantity: holding.quantity,
    avgCost: holding.avgCost,
    currentPrice: holding.currentPrice,
    marketValue: holding.marketValue,
    isEmployerStock: holding.ticker === "GOOG" || holding.ticker === "GOOGL",
}));

const SAMPLE_PORTFOLIO_VALUE = mockPortfolios[0]?.totalValue ?? SAMPLE_HOLDINGS.reduce(
    (sum, holding) => sum + holding.marketValue,
    0,
);

export function SellDisciplineCard() {
    const riskPolicy = useSettingsStore((s) => s.riskPolicy);
    const updateRiskPolicy = useSettingsStore((s) => s.updateRiskPolicy);
    const rules = riskPolicy.sellDisciplineRules;
    const [type, setType] = useState<SellDisciplineTriggerType>("allocation_cap");
    const [symbol, setSymbol] = useState("AAPL");
    const [threshold, setThreshold] = useState("10");
    const [action, setAction] = useState<SellDisciplineAction>("trim");
    const [vestDate, setVestDate] = useState(new Date().toISOString().slice(0, 10));
    const [blockAdds, setBlockAdds] = useState(true);
    const [reasons, setReasons] = useState<Record<string, string>>({});

    const summary = useMemo(
        () =>
            evaluateSellDiscipline({
                rules,
                holdings: SAMPLE_HOLDINGS,
                theses: DEFAULT_THESES,
                portfolioValue: SAMPLE_PORTFOLIO_VALUE,
            }),
        [rules],
    );
    const taskByRuleId = useMemo(
        () => new Map(summary.tasks.map((task) => [task.ruleId, task])),
        [summary.tasks],
    );

    const updateRules = (nextRules: SellDisciplineRule[]) => {
        updateRiskPolicy({ sellDisciplineRules: nextRules });
    };

    const addRule = () => {
        const nextRule = buildRule({
            type,
            symbol,
            threshold,
            action,
            vestDate,
            blockAdds,
        });
        updateRules([...rules, nextRule]);
    };

    const transitionRule = (
        rule: SellDisciplineRule,
        transition: "snooze" | "resolve" | "reactivate",
    ) => {
        const reason = (reasons[rule.id] ?? "").trim();
        if (reason.length < 8) return;
        const snoozedUntil = new Date();
        snoozedUntil.setDate(snoozedUntil.getDate() + 30);
        const nextRule = transition === "snooze"
            ? snoozeSellDisciplineRule(rule, reason, snoozedUntil)
            : transition === "resolve"
                ? resolveSellDisciplineRule(rule, reason)
                : reactivateSellDisciplineRule(rule, reason);

        updateRules(rules.map((candidate) => candidate.id === rule.id ? nextRule : candidate));
        setReasons((current) => ({ ...current, [rule.id]: "" }));
    };

    const triggered = summary.triggeredCount;
    const total = rules.length;

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-sell-discipline-head"
            data-testid="sell-discipline-card"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <ShieldAlert className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-sell-discipline-head"
                        className="pm-settings-card-title"
                    >
                        Sell discipline
                    </h2>
                </div>
                <span className="pm-settings-card-sub">
                    {triggered} triggered / {total} rules
                </span>
            </header>

            <div className="pm-settings-card-body pm-sell-card-body">
                <div className="pm-sell-summary" aria-label="Sell discipline summary">
                    <div>
                        <span className="pm-cash-summary-label">Triggered</span>
                        <strong>{summary.triggeredCount}</strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Snoozed</span>
                        <strong>{summary.snoozedCount}</strong>
                    </div>
                    <div>
                        <span className="pm-cash-summary-label">Resolved</span>
                        <strong>{summary.resolvedCount}</strong>
                    </div>
                </div>

                <div className="pm-sell-form-grid" aria-label="Create sell discipline rule">
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Trigger</span>
                        <select
                            className="pm-settings-select"
                            value={type}
                            onChange={(event) => setType(event.target.value as SellDisciplineTriggerType)}
                            aria-label="Sell discipline trigger type"
                        >
                            {SELL_DISCIPLINE_TRIGGER_TYPES.map((option) => (
                                <option key={option} value={option}>
                                    {SELL_DISCIPLINE_TRIGGER_LABELS[option]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Ticker</span>
                        <input
                            className="pm-settings-input"
                            value={symbol}
                            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                            aria-label="Sell discipline ticker"
                            maxLength={8}
                        />
                    </label>
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">
                            {type === "stale_thesis" ? "Days" : "Threshold"}
                        </span>
                        <input
                            type="number"
                            min={0}
                            step={type === "target_price" ? 1 : 0.5}
                            className="pm-settings-input"
                            value={threshold}
                            onChange={(event) => setThreshold(event.target.value)}
                            aria-label="Sell discipline threshold"
                        />
                    </label>
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Vest date</span>
                        <input
                            type="date"
                            className="pm-settings-input"
                            value={vestDate}
                            onChange={(event) => setVestDate(event.target.value)}
                            aria-label="Employer vest date"
                        />
                    </label>
                    <label className="pm-settings-field">
                        <span className="pm-settings-field-label">Action</span>
                        <select
                            className="pm-settings-select"
                            value={action}
                            onChange={(event) => setAction(event.target.value as SellDisciplineAction)}
                            aria-label="Sell discipline action"
                        >
                            {ACTION_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                    {SELL_DISCIPLINE_ACTION_LABELS[option]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="pm-sell-checkbox-row">
                        <input
                            type="checkbox"
                            checked={blockAdds}
                            onChange={(event) => setBlockAdds(event.target.checked)}
                            aria-label="Block new adds while triggered"
                        />
                        <span>Block new adds while triggered</span>
                    </label>
                    <button
                        type="button"
                        className="pm-settings-card-cta pm-sell-add-button"
                        onClick={addRule}
                    >
                        Add sell rule
                    </button>
                </div>

                <div className="pm-sell-rule-list" role="list" aria-label="Sell discipline rules">
                    {rules.map((rule) => {
                        const task = taskByRuleId.get(rule.id);
                        const displayState = task ? "triggered" : rule.state;
                        const reason = reasons[rule.id] ?? "";
                        const reasonLabel = `Action reason for ${rule.label}`;
                        return (
                            <article
                                key={rule.id}
                                className="pm-sell-rule"
                                role="listitem"
                                data-testid="sell-discipline-rule"
                                data-state={displayState}
                            >
                                <header className="pm-sell-rule-head">
                                    <div>
                                        <h3 className="pm-sell-rule-title">{rule.label}</h3>
                                        <p className="pm-sell-rule-meta">
                                            {SELL_DISCIPLINE_TRIGGER_LABELS[rule.type]} · {SELL_DISCIPLINE_ACTION_LABELS[rule.action]}
                                        </p>
                                    </div>
                                    <span className="pm-sell-pill" data-state={displayState}>
                                        {displayState}
                                    </span>
                                </header>
                                <p className="pm-sell-rule-message">
                                    {task?.message ?? rule.stateReason ?? "Waiting for the configured trigger."}
                                </p>
                                <label className="pm-settings-field">
                                    <span className="pm-settings-field-label">{reasonLabel}</span>
                                    <input
                                        className="pm-settings-input"
                                        value={reason}
                                        onChange={(event) =>
                                            setReasons((current) => ({
                                                ...current,
                                                [rule.id]: event.target.value,
                                            }))
                                        }
                                        aria-label={reasonLabel}
                                        placeholder="Why are you snoozing or resolving this?"
                                    />
                                </label>
                                <div className="pm-sell-rule-actions">
                                    <button
                                        type="button"
                                        className="pm-settings-card-cta"
                                        disabled={reason.trim().length < 8}
                                        onClick={() => transitionRule(rule, "snooze")}
                                    >
                                        Snooze 30d
                                    </button>
                                    <button
                                        type="button"
                                        className="pm-settings-card-cta"
                                        disabled={reason.trim().length < 8}
                                        onClick={() => transitionRule(rule, "resolve")}
                                    >
                                        Resolve
                                    </button>
                                    {(rule.state === "resolved" || rule.state === "snoozed") && (
                                        <button
                                            type="button"
                                            className="pm-settings-card-cta"
                                            disabled={reason.trim().length < 8}
                                            onClick={() => transitionRule(rule, "reactivate")}
                                        >
                                            Reactivate
                                        </button>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

function buildRule({
    type,
    symbol,
    threshold,
    action,
    vestDate,
    blockAdds,
}: {
    type: SellDisciplineTriggerType;
    symbol: string;
    threshold: string;
    action: SellDisciplineAction;
    vestDate: string;
    blockAdds: boolean;
}): SellDisciplineRule {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const numericThreshold = Math.max(0, Number(threshold || 0));
    const base: SellDisciplineRule = {
        id: `sell-${Date.now().toString(36)}`,
        type,
        label: `${normalizedSymbol || "Portfolio"} ${SELL_DISCIPLINE_TRIGGER_LABELS[type]}`,
        action,
        state: "active",
        symbol: normalizedSymbol || undefined,
        noAdd: blockAdds || action === "no_add",
    };

    if (type === "target_price") {
        return { ...base, targetPrice: numericThreshold };
    }
    if (type === "target_allocation") {
        return { ...base, targetAllocationPct: numericThreshold };
    }
    if (type === "employer_vest") {
        return { ...base, vestDate: vestDate || new Date().toISOString().slice(0, 10) };
    }
    return { ...base, thresholdPct: numericThreshold };
}
