import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    computeBucketAllocation,
    policyBucketLabel,
    resolvePolicyBucketAssignment,
    type PolicyClassifiableHolding,
} from "./buckets";

describe("risk policy / bucket model", () => {
    test("classifies explicit buckets ahead of ticker fallbacks", () => {
        const assignment = resolvePolicyBucketAssignment({
            symbol: "NVDA",
            policyBucket: "core",
        });

        assert.deepStrictEqual(assignment, {
            bucket: "core",
            source: "explicit",
        });
    });

    test("uses deterministic fallback buckets for known current-risk names", () => {
        assert.equal(resolvePolicyBucketAssignment({ symbol: "GOOG" }).bucket, "active");
        assert.equal(resolvePolicyBucketAssignment({ symbol: "COIN" }).bucket, "speculative");
        assert.equal(resolvePolicyBucketAssignment({ symbol: "FNMA" }).bucket, "special_situation");
        assert.equal(resolvePolicyBucketAssignment({ symbol: "SGOV" }).bucket, "cash_reserve");
        assert.equal(resolvePolicyBucketAssignment({ symbol: "VTI" }).bucket, "core");
    });

    test("routes option-like instruments to speculative even without a ticker mapping", () => {
        const assignment = resolvePolicyBucketAssignment({
            symbol: "AAPL 2027 C",
            instrumentType: "LEAPS call option",
        });

        assert.equal(assignment.bucket, "speculative");
        assert.equal(assignment.source, "instrument");
    });

    test("computes allocation by market value and marks unassigned as missing data", () => {
        const holdings: PolicyClassifiableHolding[] = [
            { id: "core", symbol: "VTI", marketValue: 70_000 },
            { id: "active", symbol: "NVDA", marketValue: 20_000 },
            { id: "unknown", symbol: "ZZZZ", marketValue: 10_000 },
        ];

        const allocation = computeBucketAllocation(holdings);
        const core = allocation.rows.find((row) => row.bucket === "core")!;
        const active = allocation.rows.find((row) => row.bucket === "active")!;
        const unassigned = allocation.rows.find((row) => row.bucket === "unassigned")!;

        assert.equal(allocation.totalMarketValue, 100_000);
        assert.equal(core.percentOfPortfolio, 70);
        assert.equal(active.percentOfPortfolio, 20);
        assert.equal(unassigned.marketValue, 10_000);
        assert.equal(unassigned.status, "missing_data");
        assert.equal(allocation.unassignedCount, 1);
        assert.match(allocation.actionPrompts[0], /Assign 1 unassigned holding/);
    });

    test("flags hard-cap breaches and exposes dollar overage", () => {
        const allocation = computeBucketAllocation([
            { symbol: "COIN", marketValue: 12_000 },
            { symbol: "VTI", marketValue: 88_000 },
        ]);
        const speculative = allocation.rows.find((row) => row.bucket === "speculative")!;

        assert.equal(speculative.status, "breached");
        assert.equal(speculative.percentOfPortfolio, 12);
        assert.equal(speculative.overCapPct, 7);
        assert.equal(speculative.overCapValue, 7_000);
    });

    test("exposes stable labels for UI chips", () => {
        assert.equal(policyBucketLabel("active"), "Active idea / satellite");
        assert.equal(policyBucketLabel("special_situation"), "Special situation");
    });
});
