import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
    computeEmployerStockDeRisking,
    computeTrimAmountToTarget,
} from "./de-risking";

describe("risk policy / employer-stock de-risking", () => {
    test("computes GOOG dollars and shares required to reach target allocations", () => {
        const summary = computeEmployerStockDeRisking({
            holdings: [
                {
                    id: "goog",
                    symbol: "GOOG",
                    quantity: 5_000,
                    currentPrice: 181,
                    marketValue: 905_000,
                },
                {
                    id: "nvda",
                    symbol: "NVDA",
                    quantity: 1_000,
                    currentPrice: 134,
                    marketValue: 134_000,
                },
            ],
            portfolioValue: 1_890_000,
            plan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                state: "active",
                targetAllocationPct: 20,
                intermediateTargetPct: 25,
                trimAmountUsd: 100_000,
                taxReservePct: 20,
                nextActionDate: "2026-06-01",
            },
            asOf: "2026-05-16",
        });

        assert.equal(summary.status, "breached");
        assert.equal(Math.round(summary.currentAllocationPct), 48);
        assert.equal(summary.sellToTargetUsd, 527_000);
        assert.equal(summary.sellToIntermediateUsd, 432_500);
        assert.ok(summary.sharesToSellToTarget > 2_900);
        assert.equal(summary.schedule.length, 5);
        assert.equal(summary.schedule[0].sellUsd, 100_000);
        assert.equal(summary.schedule[0].estimatedTaxReserveUsd, 20_000);
        assert.equal(summary.schedule[0].dueDate, "2026-06-01");
        assert.equal(summary.nextAction?.label, "Next GOOG trim");
    });

    test("handles zero holdings as missing data without a schedule", () => {
        const summary = computeEmployerStockDeRisking({
            holdings: [{ symbol: "VTI", marketValue: 100_000 }],
            portfolioValue: 100_000,
            asOf: "2026-05-16",
        });

        assert.equal(summary.status, "missing_data");
        assert.deepEqual(summary.missingSymbols, ["GOOG", "GOOGL"]);
        assert.equal(summary.sellToTargetUsd, 0);
        assert.deepEqual(summary.schedule, []);
    });

    test("returns inside policy when target is already reached", () => {
        const summary = computeEmployerStockDeRisking({
            holdings: [{ symbol: "GOOGL", marketValue: 50_000, quantity: 100, currentPrice: 500 }],
            portfolioValue: 500_000,
            plan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                targetAllocationPct: 20,
                intermediateTargetPct: 25,
            },
        });

        assert.equal(summary.status, "inside");
        assert.equal(summary.sellToTargetUsd, 0);
        assert.equal(summary.projectedTargetAllocationPct, 10);
    });

    test("supports vest-driven schedules", () => {
        const summary = computeEmployerStockDeRisking({
            holdings: [{ symbol: "GOOG", marketValue: 600_000, quantity: 3_000, currentPrice: 200 }],
            portfolioValue: 1_000_000,
            plan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                state: "active",
                targetAllocationPct: 25,
                intermediateTargetPct: 30,
                trimMethod: "vest_driven",
                plannedVestValueUsd: 80_000,
                defaultVestAction: "sell_half",
                nextVestDate: "2026-07-15",
            },
            asOf: "2026-05-16",
        });

        assert.equal(summary.schedule[0].sellUsd, 40_000);
        assert.equal(summary.schedule[0].dueDate, "2026-07-15");
        assert.equal(summary.schedule[1].dueDate, "2026-08-15");
    });

    test("exposes a small trim-to-target helper for Ask Ledger", () => {
        const result = computeTrimAmountToTarget({
            currentValueUsd: 900_000,
            portfolioValue: 1_800_000,
            targetAllocationPct: 25,
        });

        assert.equal(result.currentAllocationPct, 50);
        assert.equal(result.targetValueUsd, 450_000);
        assert.equal(result.sellUsd, 450_000);
        assert.equal(result.breachPct, 25);
    });
});
