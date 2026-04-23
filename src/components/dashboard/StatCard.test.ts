import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolvePositive } from "./StatCard";

/**
 * Phase 3 (AR-70) — covers the one piece of logic that lives inside the
 * StatCard component: sign/positive resolution.
 *
 * We deliberately don't render the component here — the rest of the card is
 * pure JSX with no branching, and the sparkline it embeds already has its
 * own tests. Everything that could go wrong in production lives in this
 * helper (wrong chip color, wrong sparkline color).
 */

describe("StatCard / resolvePositive", () => {
    it("returns the explicit value when provided", () => {
        assert.equal(resolvePositive(undefined, true), true);
        assert.equal(resolvePositive(undefined, false), false);
        assert.equal(resolvePositive("+2.4%", false), false); // explicit wins
        assert.equal(resolvePositive("-1.0%", true), true); // explicit wins
    });

    it("returns null for empty / missing delta with no override", () => {
        assert.equal(resolvePositive(undefined, undefined), null);
        assert.equal(resolvePositive("", undefined), null);
        assert.equal(resolvePositive("   ", undefined), null);
    });

    it("reads the ASCII + prefix as positive", () => {
        assert.equal(resolvePositive("+2.4%", undefined), true);
        assert.equal(resolvePositive("+$1,203", undefined), true);
    });

    it("reads the ASCII - prefix as negative", () => {
        assert.equal(resolvePositive("-0.8%", undefined), false);
        assert.equal(resolvePositive("-$100", undefined), false);
    });

    it("reads the typographic minus − prefix as negative", () => {
        assert.equal(resolvePositive("−0.8%", undefined), false);
        assert.equal(resolvePositive("−$1,203", undefined), false);
    });

    it("reads ↑ / ↓ arrows", () => {
        assert.equal(resolvePositive("↑ 4.2%", undefined), true);
        assert.equal(resolvePositive("↓ 0.8%", undefined), false);
    });

    it("falls back to the first number in the string when unsigned", () => {
        assert.equal(resolvePositive("2.4% MoM", undefined), true);
        // With no sign, a plain number inside text is assumed positive.
        assert.equal(resolvePositive("up 1.2%", undefined), true);
    });

    it("returns null for zero / non-numeric strings", () => {
        assert.equal(resolvePositive("0%", undefined), null);
        assert.equal(resolvePositive("flat", undefined), null);
        assert.equal(resolvePositive("— —", undefined), null);
    });
});
