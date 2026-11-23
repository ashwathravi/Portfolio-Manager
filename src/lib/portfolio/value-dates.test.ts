import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { editedValueAsOf as netWorthRule } from "./net-worth";
import { editedValueAsOf, localDate } from "./value-dates";

describe("localDate", () => {
    test("is the browser's calendar day, not UTC's", () => {
        // 8:30 pm local on Nov 23 is already the 24th in UTC west of Greenwich.
        assert.equal(localDate(new Date(2026, 10, 23, 20, 30)), "2026-11-23");
        assert.equal(localDate(new Date(2026, 0, 5, 0, 0)), "2026-01-05");
        assert.equal(localDate(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
    });
});

describe("editedValueAsOf for a holding valued by hand", () => {
    const FUND = { name: "Target 2055 Trust", value: 12_500, valueAsOf: "2026-11-20" };

    test("a rename keeps the holding's own date, so no value is dated anew", () => {
        assert.equal(editedValueAsOf(FUND, 12_500, "2026-11-23"), "2026-11-20");
        assert.equal(editedValueAsOf(FUND, 12_500.004, "2026-11-23"), "2026-11-20");
        // A value dated after today keeps its day too.
        assert.equal(editedValueAsOf({ value: 100, valueAsOf: "2026-12-31" }, 100, "2026-11-23"), "2026-12-31");
    });

    test("a new value, or none yet, is as of today", () => {
        assert.equal(editedValueAsOf(FUND, 13_000, "2026-11-23"), "2026-11-23");
        assert.equal(editedValueAsOf(FUND, 12_500.01, "2026-11-23"), "2026-11-23");
        assert.equal(editedValueAsOf(FUND, null, "2026-11-23"), "2026-11-23");
        assert.equal(editedValueAsOf(FUND, Number.NaN, "2026-11-23"), "2026-11-23");
    });

    test("is the rule other assets and debts use", () => {
        assert.equal(netWorthRule, editedValueAsOf);
    });
});
