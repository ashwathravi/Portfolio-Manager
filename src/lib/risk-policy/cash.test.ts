import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    advanceCashDeploymentDate,
    computeCashPolicySummary,
    DEFAULT_CASH_DEPLOYMENT_RULE,
} from "./cash";

describe("computeCashPolicySummary", () => {
    test("calculates reserved, excess, deployment, and unassigned cash", () => {
        const summary = computeCashPolicySummary({
            totalCash: 224_000,
            jobs: [
                { id: "cash-emergency", type: "emergency_fund", label: "Emergency fund", amount: 60_000 },
                { id: "cash-tax", type: "tax_reserve", label: "Tax reserve", amount: 30_000 },
                { id: "cash-deploy", type: "scheduled_deployment", label: "Scheduled deployment", amount: 25_000 },
            ],
            asOf: "2026-05-15",
        });

        assert.equal(summary.assignedCash, 115_000);
        assert.equal(summary.reservedCash, 90_000);
        assert.equal(summary.deploymentCash, 25_000);
        assert.equal(summary.excessCash, 134_000);
        assert.equal(summary.unassignedCash, 109_000);
        assert.equal(summary.status, "missing_data");
        assert.match(summary.actionPrompts[0], /Assign \$109,000/);
    });

    test("marks a fully classified cash stack as inside policy", () => {
        const summary = computeCashPolicySummary({
            totalCash: 224_000,
            jobs: [
                { id: "cash-emergency", type: "emergency_fund", label: "Emergency fund", amount: 60_000 },
                { id: "cash-tax", type: "tax_reserve", label: "Tax reserve", amount: 30_000 },
                { id: "cash-deploy", type: "scheduled_deployment", label: "Scheduled deployment", amount: 134_000 },
            ],
            asOf: "2026-05-15",
        });

        assert.equal(summary.unassignedCash, 0);
        assert.equal(summary.overAllocatedCash, 0);
        assert.equal(summary.status, "inside");
        assert.deepEqual(summary.actionPrompts, []);
    });

    test("surfaces a due scheduled deployment rule", () => {
        const summary = computeCashPolicySummary({
            totalCash: 100_000,
            jobs: [
                { id: "cash-emergency", type: "emergency_fund", label: "Emergency fund", amount: 40_000 },
                { id: "cash-deploy", type: "scheduled_deployment", label: "Scheduled deployment", amount: 60_000 },
            ],
            deploymentRule: {
                ...DEFAULT_CASH_DEPLOYMENT_RULE,
                enabled: true,
                percentOfExcess: 25,
                destination: "Core index allocation",
                nextDueDate: "2026-05-01",
            },
            asOf: "2026-05-15",
        });

        assert.equal(summary.deploymentDue, true);
        assert.equal(summary.nextDeploymentAmount, 15_000);
        assert.equal(summary.status, "watch");
        assert.match(summary.actionPrompts[0], /Deploy \$15,000 to Core index allocation/);
    });

    test("supports an expiry-based acknowledgement for unassigned cash", () => {
        const summary = computeCashPolicySummary({
            totalCash: 50_000,
            jobs: [],
            deploymentRule: {
                ...DEFAULT_CASH_DEPLOYMENT_RULE,
                unassignedAcknowledgedUntil: "2026-06-14",
            },
            asOf: "2026-05-15",
        });

        assert.equal(summary.unassignedCash, 50_000);
        assert.equal(summary.status, "watch");
        assert.match(summary.actionPrompts[0], /Review \$50,000 unassigned cash by 2026-06-14/);
    });

    test("flags cash jobs that exceed available cash", () => {
        const summary = computeCashPolicySummary({
            totalCash: 100_000,
            jobs: [
                { id: "cash-emergency", type: "emergency_fund", label: "Emergency fund", amount: 150_000 },
            ],
            asOf: "2026-05-15",
        });

        assert.equal(summary.overAllocatedCash, 50_000);
        assert.equal(summary.status, "breached");
        assert.match(summary.actionPrompts[0], /Reduce cash job allocations by \$50,000/);
    });
});

describe("advanceCashDeploymentDate", () => {
    test("advances monthly and quarterly deployment dates", () => {
        assert.equal(advanceCashDeploymentDate("2026-05-15", "monthly"), "2026-06-15");
        assert.equal(advanceCashDeploymentDate("2026-05-15", "quarterly"), "2026-08-15");
    });
});
