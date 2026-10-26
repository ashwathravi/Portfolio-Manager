import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    computeBucketAllocation,
    defaultPolicyBucket,
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

    test("a holding starts in the bucket its security type suggests", () => {
        const of = (type: string | null, sector: string | null = null) => defaultPolicyBucket("XYZ", { type, sector });
        assert.equal(of("ETF", "Funds"), "core");
        assert.equal(of("ETF", "Bonds"), "core");
        assert.equal(of("BOND"), "core");
        assert.equal(of("CS", "Tech"), "active");
        assert.equal(of("ADRC", "Healthcare"), "active");
        assert.equal(of("PFD", "Finance"), "active");
        assert.equal(of("WARRANT"), "speculative");
        assert.equal(of("ETF", "Crypto"), "speculative");
        assert.equal(of(null), null);
        assert.equal(defaultPolicyBucket("XYZ"), null);
        // A well-known ticker keeps its bucket whatever its type.
        assert.equal(defaultPolicyBucket("FNMA", { type: "CS", sector: "Finance" }), "special_situation");
        assert.equal(defaultPolicyBucket("sgov", { type: "ETF", sector: "Bonds" }), "cash_reserve");
    });

    test("the user's choice, then the instrument, then the default the page worked out", () => {
        assert.deepEqual(resolvePolicyBucketAssignment({ symbol: "XYZ", defaultBucket: "core" }), { bucket: "core", source: "fallback" });
        assert.deepEqual(resolvePolicyBucketAssignment({ symbol: "XYZ", defaultBucket: "core", policyBucket: "active" }), { bucket: "active", source: "explicit" });
        // A default worked out as none: unassigned, even for a well-known ticker.
        assert.deepEqual(resolvePolicyBucketAssignment({ symbol: "VTI", defaultBucket: null }), { bucket: "unassigned", source: "missing" });
        assert.deepEqual(resolvePolicyBucketAssignment({ symbol: "XYZ", defaultBucket: "unassigned" }), { bucket: "unassigned", source: "missing" });
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
