import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { defaultPersistedSettings } from "@/lib/stores/settingsStore";

import { SETTINGS_VERSION } from "./document";
import { storedRiskPolicy } from "./risk-policy";

describe("storedRiskPolicy", () => {
    const defaults = defaultPersistedSettings().riskPolicy;

    test("the defaults without stored settings, or when they can't be read", () => {
        assert.deepEqual(storedRiskPolicy({ status: "unavailable" }), defaults);
        assert.deepEqual(storedRiskPolicy({ status: "ok", document: null }), defaults);
        assert.deepEqual(
            storedRiskPolicy({ status: "ok", document: { version: SETTINGS_VERSION, settings: { demo: { showSampleData: false } }, updatedAt: "2026-10-26T12:00:00.000Z" } }),
            defaults,
        );
    });

    test("the user's own policy: their choices, caps and employer stock", () => {
        const riskPolicy = {
            ...defaults,
            themeCaps: { ...defaults.themeCaps, semiconductors: 12 },
            employerStockPlan: { ...defaults.employerStockPlan, symbols: ["GOOG", "GOOGL"] },
            bucketAssignments: { TSLA: "speculative" as const },
        };
        const stored = storedRiskPolicy({
            status: "ok",
            document: { version: SETTINGS_VERSION, settings: { riskPolicy }, updatedAt: "2026-10-26T12:00:00.000Z" },
        });
        assert.deepEqual(stored, riskPolicy);
    });

    test("keeps the bucket chosen for a holding valued by hand; a key the app couldn't have written goes", () => {
        const fund = "manual:00000000-0000-4000-8000-000000000001";
        const stored = storedRiskPolicy({
            status: "ok",
            document: {
                version: 17,
                settings: {
                    riskPolicy: {
                        ...defaults,
                        bucketAssignments: { [fund]: "speculative", "MANUAL:00000000-0000-4000-8000-000000000002": "core", TSLA: "active" },
                    },
                },
                updatedAt: "2026-11-23T12:00:00.000Z",
            },
        });
        assert.deepEqual(stored.bucketAssignments, { [fund]: "speculative", TSLA: "active" });
    });

    test("an older document is migrated, and what the app couldn't have written is repaired", () => {
        const v15: Partial<typeof defaults> = { ...defaults };
        delete v15.bucketAssignments;
        const stored = storedRiskPolicy({
            status: "ok",
            document: {
                version: 15,
                settings: { riskPolicy: { ...v15, themeCaps: { semiconductors: "lots" } } },
                updatedAt: "2026-10-26T12:00:00.000Z",
            },
        });
        assert.deepEqual(stored.bucketAssignments, {});
        assert.equal(stored.themeCaps.semiconductors, defaults.themeCaps.semiconductors);
    });
});
