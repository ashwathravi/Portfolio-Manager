import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    evaluateSellDiscipline,
    reactivateSellDisciplineRule,
    resolveSellDisciplineRule,
    sellDisciplineBlocksAdd,
    snoozeSellDisciplineRule,
    type SellDisciplineHolding,
    type SellDisciplineRule,
    type SellDisciplineThesis,
} from "./sell-discipline";

const HOLDINGS: SellDisciplineHolding[] = [
    {
        symbol: "AAPL",
        name: "Apple",
        quantity: 500,
        avgCost: 100,
        currentPrice: 225,
        marketValue: 112_500,
    },
    {
        symbol: "NVDA",
        name: "NVIDIA",
        quantity: 100,
        avgCost: 900,
        currentPrice: 600,
        marketValue: 60_000,
    },
    {
        symbol: "GOOG",
        name: "Alphabet",
        quantity: 200,
        avgCost: 120,
        currentPrice: 190,
        marketValue: 38_000,
        isEmployerStock: true,
    },
];

const THESES: SellDisciplineThesis[] = [
    { id: "th-aapl", ticker: "AAPL", targetPrice: 220, dateUpdated: "2025-01-01", healthScore: 80 },
    { id: "th-nvda", ticker: "NVDA", targetPrice: 950, dateUpdated: "2026-05-01", healthScore: 35 },
    { id: "th-archived", ticker: "GOOG", status: "archived", dateUpdated: "2026-05-01", healthScore: 20 },
];

function rule(patch: Partial<SellDisciplineRule>): SellDisciplineRule {
    return {
        id: patch.id ?? `rule-${patch.type ?? "allocation_cap"}`,
        type: patch.type ?? "allocation_cap",
        label: patch.label ?? "Test sell rule",
        action: patch.action ?? "trim",
        state: patch.state ?? "active",
        ...patch,
    };
}

describe("sell discipline policy engine", () => {
    test("triggers allocation caps and no-add blocks", () => {
        const summary = evaluateSellDiscipline({
            holdings: HOLDINGS,
            theses: THESES,
            portfolioValue: 250_000,
            rules: [
                rule({
                    id: "aapl-cap",
                    symbol: "AAPL",
                    thresholdPct: 20,
                    noAdd: true,
                }),
            ],
            asOf: "2026-05-15",
        });

        assert.equal(summary.triggeredCount, 1);
        assert.equal(summary.tasks[0].ruleType, "allocation_cap");
        assert.equal(summary.tasks[0].symbol, "AAPL");
        assert.equal(summary.tasks[0].noAdd, true);
        assert.equal(sellDisciplineBlocksAdd(summary.tasks, "aapl")?.ruleId, "aapl-cap");
    });

    test("triggers drawdown re-underwrite rules", () => {
        const summary = evaluateSellDiscipline({
            holdings: HOLDINGS,
            portfolioValue: 250_000,
            rules: [
                rule({
                    type: "drawdown_reunderwrite",
                    symbol: "NVDA",
                    thresholdPct: 30,
                    action: "re_underwrite",
                }),
            ],
        });

        assert.equal(summary.triggeredCount, 1);
        assert.match(summary.tasks[0].message, /down/);
        assert.equal(summary.tasks[0].action, "re_underwrite");
    });

    test("triggers stale thesis and target price rules", () => {
        const summary = evaluateSellDiscipline({
            holdings: HOLDINGS,
            theses: THESES,
            portfolioValue: 250_000,
            rules: [
                rule({ id: "portfolio-stale", type: "stale_thesis", thresholdPct: 180, action: "re_underwrite" }),
                rule({ type: "stale_thesis", symbol: "AAPL", thresholdPct: 180, action: "re_underwrite" }),
                rule({ type: "target_price", symbol: "AAPL", targetPrice: 220, action: "trim" }),
            ],
            asOf: "2026-05-15",
        });

        assert.equal(summary.triggeredCount, 3);
        assert.equal(summary.tasks.filter((task) => task.ruleType === "stale_thesis").length, 2);
        assert.ok(summary.tasks.some((task) => task.ruleType === "target_price"));
    });

    test("triggers employer vest, doubled position, thesis break, and missing-thesis no-add", () => {
        const summary = evaluateSellDiscipline({
            holdings: [
                ...HOLDINGS,
                {
                    symbol: "MSFT",
                    name: "Microsoft",
                    quantity: 25,
                    avgCost: 300,
                    currentPrice: 420,
                    marketValue: 10_500,
                },
            ],
            theses: THESES,
            portfolioValue: 250_000,
            rules: [
                rule({ type: "employer_vest", symbol: "GOOG", vestDate: "2026-05-01", action: "trim" }),
                rule({ type: "position_doubled", symbol: "AAPL", action: "recover_cost" }),
                rule({ type: "thesis_break", symbol: "GOOG", action: "exit" }),
                rule({ type: "missing_thesis_no_add", symbol: "MSFT", action: "no_add", noAdd: true }),
            ],
            asOf: "2026-05-15",
        });

        assert.equal(summary.triggeredCount, 4);
        assert.ok(summary.tasks.some((task) => task.ruleType === "employer_vest"));
        assert.ok(summary.tasks.some((task) => task.ruleType === "position_doubled"));
        assert.ok(summary.tasks.some((task) => task.ruleType === "thesis_break"));
        assert.ok(summary.tasks.some((task) => task.ruleType === "missing_thesis_no_add"));
        assert.equal(sellDisciplineBlocksAdd(summary.tasks, "MSFT")?.ruleType, "missing_thesis_no_add");
    });

    test("state transitions add audit trail and suppress snoozed/resolved rules", () => {
        const active = rule({ symbol: "AAPL", thresholdPct: 20 });
        const snoozed = snoozeSellDisciplineRule(active, "Review after earnings.", "2026-06-15", "2026-05-15");
        const snoozedSummary = evaluateSellDiscipline({
            holdings: HOLDINGS,
            portfolioValue: 250_000,
            rules: [snoozed],
            asOf: "2026-05-20",
        });

        assert.equal(snoozedSummary.triggeredCount, 0);
        assert.equal(snoozedSummary.snoozedCount, 1);
        assert.equal(snoozed.auditTrail?.at(-1)?.type, "snoozed");

        const resolved = resolveSellDisciplineRule(snoozed, "Trim completed.", "2026-05-21");
        const resolvedSummary = evaluateSellDiscipline({
            holdings: HOLDINGS,
            portfolioValue: 250_000,
            rules: [resolved],
            asOf: "2026-05-22",
        });

        assert.equal(resolvedSummary.triggeredCount, 0);
        assert.equal(resolvedSummary.resolvedCount, 1);
        assert.equal(resolved.auditTrail?.at(-1)?.type, "resolved");

        const reactivated = reactivateSellDisciplineRule(resolved, "Need to monitor again.", "2026-05-23");
        assert.equal(reactivated.state, "active");
        assert.equal(reactivated.auditTrail?.at(-1)?.type, "reactivated");
    });
});
