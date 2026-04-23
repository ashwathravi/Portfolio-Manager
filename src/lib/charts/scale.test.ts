import { describe, test } from "node:test";
import assert from "node:assert";

import {
    linearScale,
    niceTicks,
    buildLinePath,
    buildAreaPath,
    buildDonutSegment,
    polarToCartesian,
    fmt,
} from "./scale";

/**
 * Unit coverage for the framework-free chart math helpers that back
 * AreaChart, Sparkline, Donut, and BarChart. These run without jsdom — the
 * helpers never touch the DOM or React.
 */

describe("linearScale", () => {
    test("maps midpoint of domain to midpoint of range", () => {
        assert.strictEqual(linearScale(5, 0, 10, 0, 100), 50);
    });

    test("maps endpoints exactly", () => {
        assert.strictEqual(linearScale(0, 0, 10, 200, 0), 200);
        assert.strictEqual(linearScale(10, 0, 10, 200, 0), 0);
    });

    test("degenerate domain returns range midpoint (no NaN)", () => {
        assert.strictEqual(linearScale(5, 5, 5, 0, 100), 50);
    });

    test("extrapolates outside domain linearly", () => {
        assert.strictEqual(linearScale(-5, 0, 10, 0, 100), -50);
        assert.strictEqual(linearScale(15, 0, 10, 0, 100), 150);
    });
});

describe("niceTicks", () => {
    test("produces round ticks that cover the extent", () => {
        const ticks = niceTicks(0, 100, 6);
        // Should start at 0 and end at 100, step 20.
        assert.deepStrictEqual(ticks, [0, 20, 40, 60, 80, 100]);
    });

    test("handles fractional ranges", () => {
        const ticks = niceTicks(0, 1, 6);
        // Nice step 0.2 -> 0, 0.2, 0.4, 0.6, 0.8, 1.
        assert.deepStrictEqual(ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
    });

    test("handles negative to positive extent", () => {
        const ticks = niceTicks(-50, 50, 6);
        // Includes 0 so BarChart has a zero line.
        assert.ok(ticks.includes(0));
        assert.ok(ticks[0]! <= -50);
        assert.ok(ticks[ticks.length - 1]! >= 50);
    });

    test("degenerate input returns a single tick", () => {
        assert.deepStrictEqual(niceTicks(42, 42, 5), [42]);
    });

    test("non-finite input returns empty", () => {
        assert.deepStrictEqual(niceTicks(NaN, 10, 5), []);
        assert.deepStrictEqual(niceTicks(0, Infinity, 5), []);
    });
});

describe("buildLinePath", () => {
    test("empty input produces empty string", () => {
        assert.strictEqual(buildLinePath([]), "");
    });

    test("single-point input draws a zero-length line", () => {
        // Zero-length so that a `stroke-linecap="round"` renders as a dot.
        assert.strictEqual(buildLinePath([{ x: 10, y: 20 }]), "M 10 20 L 10 20");
    });

    test("straight mode draws M + L commands", () => {
        const d = buildLinePath([
            { x: 0, y: 0 },
            { x: 10, y: 5 },
            { x: 20, y: 0 },
        ]);
        assert.strictEqual(d, "M 0 0 L 10 5 L 20 0");
    });

    test("smooth mode draws Q/T curves starting at M", () => {
        const d = buildLinePath(
            [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
            ],
            true,
        );
        assert.ok(d.startsWith("M 0 0"));
        assert.ok(d.includes("Q"));
        assert.ok(d.includes("T 10 10"));
    });
});

describe("buildAreaPath", () => {
    test("closes the area to the baseline", () => {
        const d = buildAreaPath(
            [
                { x: 0, y: 10 },
                { x: 10, y: 0 },
            ],
            50,
        );
        // Must return to baseline at last x, then first x, then close.
        assert.ok(d.endsWith("L 10 50 L 0 50 Z"));
    });

    test("empty input produces empty string", () => {
        assert.strictEqual(buildAreaPath([], 100), "");
    });
});

describe("polarToCartesian", () => {
    test("angle 0 is +x direction from center", () => {
        const p = polarToCartesian(100, 100, 10, 0);
        assert.strictEqual(Math.round(p.x), 110);
        assert.strictEqual(Math.round(p.y), 100);
    });

    test("angle PI/2 is +y direction from center", () => {
        const p = polarToCartesian(100, 100, 10, Math.PI / 2);
        assert.strictEqual(Math.round(p.x), 100);
        assert.strictEqual(Math.round(p.y), 110);
    });
});

describe("buildDonutSegment", () => {
    test("produces a valid arc path string with both arc commands", () => {
        // A 90° segment from top (−π/2 offset puts 0 at 12 o'clock).
        const d = buildDonutSegment(100, 100, 50, 30, 0, Math.PI / 2);
        assert.ok(d.startsWith("M "));
        // Two arc commands — one for outer edge, one for inner edge.
        const arcCount = (d.match(/A /g) || []).length;
        assert.strictEqual(arcCount, 2);
        assert.ok(d.endsWith("Z"));
    });

    test("marks large-arc flag for >180° segments", () => {
        const d = buildDonutSegment(0, 0, 10, 5, 0, Math.PI * 1.5);
        // The pattern "0 1 1" appears for the outer arc with large-arc=1, sweep=1.
        assert.ok(/A 10 10 0 1 1/.test(d));
    });

    test("zero-sweep returns empty path", () => {
        assert.strictEqual(buildDonutSegment(0, 0, 10, 5, 1, 1), "");
    });
});

describe("fmt", () => {
    test("rounds to at most 2 decimals", () => {
        assert.strictEqual(fmt(1.23456), "1.23");
        assert.strictEqual(fmt(1.0), "1");
        assert.strictEqual(fmt(1.5), "1.5");
    });

    test("handles non-finite safely", () => {
        assert.strictEqual(fmt(NaN), "0");
        assert.strictEqual(fmt(Infinity), "0");
    });

    test("strips trailing zeros", () => {
        assert.strictEqual(fmt(1.1), "1.1");
        assert.strictEqual(fmt(1.1), "1.1");
    });
});
