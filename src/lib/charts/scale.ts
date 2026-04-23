/**
 * Shared math helpers for the SVG chart primitives under
 * `src/components/charts/`. Kept pure and data-agnostic so each chart
 * component can be covered by visual tests (via Storybook/preview) and the
 * math by unit tests here.
 *
 * Everything in this module is framework-free — no React, no DOM — so it
 * runs under `node --test` without jsdom.
 */

// ---------------------------------------------------------------------------
// Linear scale
// ---------------------------------------------------------------------------

/**
 * Map `value` from an input domain `[d0, d1]` to an output range `[r0, r1]`.
 * If the domain has zero width (all values equal), returns the midpoint of
 * the range so we don't divide by zero and still get a visible baseline.
 */
export function linearScale(
    value: number,
    d0: number,
    d1: number,
    r0: number,
    r1: number,
): number {
    if (d1 === d0) return (r0 + r1) / 2;
    const t = (value - d0) / (d1 - d0);
    return r0 + t * (r1 - r0);
}

// ---------------------------------------------------------------------------
// Nice ticks (for grid lines / y-axis labels)
// ---------------------------------------------------------------------------

/**
 * Given a numeric extent, return up to `count` evenly-spaced "nice" tick
 * values that cover it. Nice == powers of 10 scaled by {1, 2, 2.5, 5}.
 *
 * Used by AreaChart to place horizontal grid lines and by BarChart to
 * anchor its zero line and positive/negative ticks.
 */
export function niceTicks(min: number, max: number, count: number = 5): number[] {
    if (!Number.isFinite(min) || !Number.isFinite(max) || count <= 0) return [];
    if (min === max) {
        // Degenerate: a single value — show it as the only tick.
        return [min];
    }
    const range = niceNum(max - min, false);
    const step = niceNum(range / Math.max(1, count - 1), true);
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    const ticks: number[] = [];
    // Use a float-tolerant stop: tiny rounding error could skip the last tick.
    for (let v = niceMin; v <= niceMax + step * 1e-9; v += step) {
        ticks.push(round(v, step));
    }
    return ticks;
}

function niceNum(range: number, round: boolean): number {
    if (range === 0) return 0;
    const sign = Math.sign(range) || 1;
    const abs = Math.abs(range);
    const exponent = Math.floor(Math.log10(abs));
    const fraction = abs / Math.pow(10, exponent);
    let nice: number;
    if (round) {
        if (fraction < 1.5) nice = 1;
        else if (fraction < 3) nice = 2;
        else if (fraction < 7) nice = 5;
        else nice = 10;
    } else {
        if (fraction <= 1) nice = 1;
        else if (fraction <= 2) nice = 2;
        else if (fraction <= 5) nice = 5;
        else nice = 10;
    }
    return sign * nice * Math.pow(10, exponent);
}

/**
 * Round `value` to the same number of decimal places as `step`, so
 * ticks like 0.1, 0.2 don't drift into 0.30000000000000004.
 */
function round(value: number, step: number): number {
    if (step === 0) return value;
    const decimals = Math.max(0, -Math.floor(Math.log10(Math.abs(step))));
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

export interface Point {
    x: number;
    y: number;
}

/**
 * Build an SVG `d` attribute for a polyline through `points`. `smooth`
 * draws a Catmull-Rom-like cubic Bézier curve for a softer line (used by
 * AreaChart and Sparkline). Non-smooth is straight segments.
 */
export function buildLinePath(points: Point[], smooth: boolean = false): string {
    if (points.length === 0) return "";
    if (points.length === 1) {
        // Degenerate: a single point — draw a zero-length line so the stroke
        // renders a dot if the caller adds linecap="round".
        const p = points[0]!;
        return `M ${fmt(p.x)} ${fmt(p.y)} L ${fmt(p.x)} ${fmt(p.y)}`;
    }
    if (!smooth) {
        const [first, ...rest] = points;
        const head = `M ${fmt(first!.x)} ${fmt(first!.y)}`;
        const tail = rest.map((p) => `L ${fmt(p.x)} ${fmt(p.y)}`).join(" ");
        return `${head} ${tail}`;
    }
    // Monotone cubic-ish smoothing: use the midpoint between each pair
    // of points as the cubic control. Cheap, no overshoot, looks good for
    // financial series. Based on the "smooth line" trick used by sparkline
    // implementations like micro-charts.
    let d = `M ${fmt(points[0]!.x)} ${fmt(points[0]!.y)}`;
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]!;
        const curr = points[i]!;
        const midX = (prev.x + curr.x) / 2;
        d += ` Q ${fmt(midX)} ${fmt(prev.y)} ${fmt(midX)} ${fmt((prev.y + curr.y) / 2)}`;
        d += ` T ${fmt(curr.x)} ${fmt(curr.y)}`;
    }
    return d;
}

/**
 * Build an SVG `d` attribute for a filled area between `points` and the
 * baseline `y = baselineY`. Used by AreaChart and Sparkline for the
 * gradient fill under the stroke.
 */
export function buildAreaPath(points: Point[], baselineY: number, smooth: boolean = false): string {
    if (points.length === 0) return "";
    const linePath = buildLinePath(points, smooth);
    const last = points[points.length - 1]!;
    const first = points[0]!;
    // `L lastX baselineY L firstX baselineY Z` closes the area.
    return `${linePath} L ${fmt(last.x)} ${fmt(baselineY)} L ${fmt(first.x)} ${fmt(baselineY)} Z`;
}

/** Shorten numeric SVG coords to 2 decimals — rendering precision, keeps DOM lean. */
export function fmt(n: number): string {
    if (!Number.isFinite(n)) return "0";
    // Round to 2 decimals; strip trailing zero / decimal point.
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? r.toString() : r.toFixed(2).replace(/\.?0+$/, "");
}

// ---------------------------------------------------------------------------
// Polar (used by Donut)
// ---------------------------------------------------------------------------

/** Convert polar (radius, angle in radians) to cartesian around (cx, cy). */
export function polarToCartesian(
    cx: number,
    cy: number,
    radius: number,
    angleRad: number,
): Point {
    return {
        x: cx + radius * Math.cos(angleRad),
        y: cy + radius * Math.sin(angleRad),
    };
}

/**
 * Build the SVG `d` attribute for a donut segment from `startRad` to
 * `endRad` with outer radius `outer` and inner radius `inner`. Angles are
 * in radians, measured clockwise from 12 o'clock (−π/2 offset).
 *
 * We offset by −π/2 inside this function so the caller can pass angles in
 * a "0 = top" mental model.
 */
export function buildDonutSegment(
    cx: number,
    cy: number,
    outer: number,
    inner: number,
    startRad: number,
    endRad: number,
): string {
    // Clamp: SVG arcs can't draw a full 360° in one command; callers that
    // want a full ring should split into two halves or use a <circle>.
    const sweep = endRad - startRad;
    if (!Number.isFinite(sweep) || sweep <= 0) return "";

    const offset = -Math.PI / 2;
    const sa = startRad + offset;
    const ea = endRad + offset;
    const largeArc = sweep > Math.PI ? 1 : 0;

    const outerStart = polarToCartesian(cx, cy, outer, sa);
    const outerEnd = polarToCartesian(cx, cy, outer, ea);
    const innerStart = polarToCartesian(cx, cy, inner, ea);
    const innerEnd = polarToCartesian(cx, cy, inner, sa);

    return [
        `M ${fmt(outerStart.x)} ${fmt(outerStart.y)}`,
        `A ${fmt(outer)} ${fmt(outer)} 0 ${largeArc} 1 ${fmt(outerEnd.x)} ${fmt(outerEnd.y)}`,
        `L ${fmt(innerStart.x)} ${fmt(innerStart.y)}`,
        `A ${fmt(inner)} ${fmt(inner)} 0 ${largeArc} 0 ${fmt(innerEnd.x)} ${fmt(innerEnd.y)}`,
        "Z",
    ].join(" ");
}
