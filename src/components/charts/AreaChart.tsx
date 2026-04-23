"use client";

import { useId, useMemo, type CSSProperties } from "react";
import {
    linearScale,
    niceTicks,
    buildLinePath,
    buildAreaPath,
    fmt,
    type Point,
} from "@/lib/charts/scale";

/**
 * Phase 2 (AR-69) area chart primitive.
 *
 * Pure SVG, data-agnostic, responsive via viewBox. Used by Dashboard's
 * equity curve, Performance's TWR curve, and Research's price-since-open
 * mini chart.
 *
 * Design notes:
 *   - Portfolio line uses `--pm-accent` (overridable via `accent` prop) with
 *     a vertical gradient fill from accent@24% down to accent@0%.
 *   - Benchmark line is dashed `--pm-fg-subtle` (overridable via `benchmarkColor`).
 *   - End-of-series dot + halo sits on the last portfolio point; the halo is
 *     a pulsing circle that respects `prefers-reduced-motion` via CSS.
 *   - Grid lines (horizontal only) are placed at `niceTicks` values inside
 *     the y-domain spanning both series.
 *   - X-axis labels adapt to `range`: fixed-slot labels (5 across) for the
 *     standard ranges, or empty when none is supplied.
 *
 * The component does NOT do date parsing — it plots numeric series by
 * index. Callers format their own axis labels via `xLabels` if they want
 * something other than the `range` defaults.
 */

export type AreaChartRange = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "ALL";

export interface AreaChartProps {
    /** Primary (portfolio) series, plotted left-to-right by index. */
    data: number[];
    /** Optional benchmark series; drawn as a dashed line. Must share index with `data`. */
    benchmark?: number[];
    /** Time range hint — drives default x-axis labels. */
    range?: AreaChartRange;
    /** Explicit x-axis labels; when provided, overrides the `range` defaults. 5 labels typical. */
    xLabels?: string[];
    /**
     * viewBox dimensions. The SVG itself is 100% width; these drive the
     * aspect ratio inside the viewBox. Defaults to a ~3:1 ratio that
     * matches the handoff cards.
     */
    width?: number;
    height?: number;
    /** Override for the portfolio line color. Defaults to `--pm-accent`. */
    accent?: string;
    /** Override for the benchmark line color. Defaults to `--pm-fg-subtle`. */
    benchmarkColor?: string;
    /** Show horizontal grid lines (at nice y-ticks). Default true. */
    showGrid?: boolean;
    /** Show the end-of-series dot + halo. Default true. */
    showEndDot?: boolean;
    /** Smooth curve vs. straight polyline. Default true (smoother equity look). */
    smooth?: boolean;
    /** Accessible label; required for screen-reader parity. */
    ariaLabel?: string;
    /** Optional className for the wrapping <figure>. */
    className?: string;
    style?: CSSProperties;
}

// Default x-label slots per range. Kept simple — 5 labels max fits all
// common card widths without overlap.
const DEFAULT_X_LABELS: Record<AreaChartRange, string[]> = {
    "1D": ["9:30", "11:00", "12:30", "14:00", "15:30"],
    "1W": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "1M": ["W1", "W2", "W3", "W4"],
    "3M": ["M1", "M2", "M3"],
    "6M": ["M1", "M2", "M3", "M4", "M5", "M6"],
    "YTD": ["Jan", "Apr", "Jul", "Oct"],
    "1Y": ["Jan", "Apr", "Jul", "Oct", "Dec"],
    "3Y": ["Y-3", "Y-2", "Y-1", "Now"],
    "ALL": ["Start", "", "", "", "Now"],
};

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 200;
const PAD_TOP = 16;
const PAD_RIGHT = 16;
const PAD_BOTTOM = 28;
const PAD_LEFT = 44;

export function AreaChart({
    data,
    benchmark,
    range,
    xLabels,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    accent,
    benchmarkColor,
    showGrid = true,
    showEndDot = true,
    smooth = true,
    ariaLabel,
    className,
    style,
}: AreaChartProps) {
    const uid = useId();
    const gradId = `pm-area-grad-${uid}`;

    const chart = useMemo(
        () => computeChart({ data, benchmark, width, height }),
        [data, benchmark, width, height],
    );

    const labels = xLabels ?? (range ? DEFAULT_X_LABELS[range] : []);
    const accentColor = accent ?? "var(--pm-accent)";
    const benchColor = benchmarkColor ?? "var(--pm-fg-subtle)";

    if (chart.portfolioPoints.length === 0) {
        // Nothing to draw — render the box so layout doesn't jump.
        return (
            <figure
                className={className}
                style={style}
                aria-label={ariaLabel ?? "Empty chart"}
            >
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    width="100%"
                    height="auto"
                    role="img"
                    aria-hidden={!ariaLabel}
                    preserveAspectRatio="none"
                />
            </figure>
        );
    }

    return (
        <figure
            className={className}
            style={style}
            aria-label={ariaLabel}
        >
            <svg
                viewBox={`0 0 ${width} ${height}`}
                width="100%"
                height="auto"
                role="img"
                aria-label={ariaLabel}
                preserveAspectRatio="none"
            >
                <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={accentColor} stopOpacity="0.24" />
                        <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
                    </linearGradient>
                </defs>

                {showGrid && (
                    <g className="pm-chart-grid">
                        {chart.yTicks.map((tick) => (
                            <line
                                key={tick.value}
                                x1={PAD_LEFT}
                                x2={width - PAD_RIGHT}
                                y1={tick.y}
                                y2={tick.y}
                                stroke="var(--pm-border)"
                                strokeDasharray="3 3"
                                strokeWidth={1}
                                opacity={0.55}
                            />
                        ))}
                    </g>
                )}

                {showGrid && (
                    <g className="pm-chart-y-labels">
                        {chart.yTicks.map((tick) => (
                            <text
                                key={tick.value}
                                x={PAD_LEFT - 8}
                                y={tick.y}
                                dy="0.35em"
                                fontSize={11}
                                fontFamily="var(--pm-font-mono, monospace)"
                                fill="var(--pm-fg-subtle)"
                                textAnchor="end"
                            >
                                {tick.label}
                            </text>
                        ))}
                    </g>
                )}

                {/* Area fill (portfolio only) */}
                <path
                    d={buildAreaPath(chart.portfolioPoints, chart.baselineY, smooth)}
                    fill={`url(#${gradId})`}
                    stroke="none"
                />

                {/* Benchmark line (dashed) */}
                {chart.benchmarkPoints.length > 0 && (
                    <path
                        d={buildLinePath(chart.benchmarkPoints, smooth)}
                        fill="none"
                        stroke={benchColor}
                        strokeWidth={1.5}
                        strokeDasharray="5 4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                )}

                {/* Portfolio line */}
                <path
                    d={buildLinePath(chart.portfolioPoints, smooth)}
                    fill="none"
                    stroke={accentColor}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* End-of-series dot + halo */}
                {showEndDot && chart.endDot && (
                    <g>
                        <circle
                            className="pm-chart-halo"
                            cx={chart.endDot.x}
                            cy={chart.endDot.y}
                            r={8}
                            fill={accentColor}
                            opacity={0.22}
                        />
                        <circle
                            cx={chart.endDot.x}
                            cy={chart.endDot.y}
                            r={3.5}
                            fill={accentColor}
                            stroke="var(--pm-card)"
                            strokeWidth={1.5}
                        />
                    </g>
                )}

                {/* X-axis labels */}
                {labels.length > 0 && (
                    <g className="pm-chart-x-labels">
                        {labels.map((label, i) => {
                            if (!label) return null;
                            // Evenly distribute labels across the plot area.
                            const t = labels.length === 1 ? 0.5 : i / (labels.length - 1);
                            const x = PAD_LEFT + t * (width - PAD_LEFT - PAD_RIGHT);
                            const anchor =
                                i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle";
                            return (
                                <text
                                    key={`${label}-${i}`}
                                    x={x}
                                    y={height - 6}
                                    fontSize={11}
                                    fill="var(--pm-fg-subtle)"
                                    textAnchor={anchor}
                                >
                                    {label}
                                </text>
                            );
                        })}
                    </g>
                )}
            </svg>
        </figure>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ComputeArgs {
    data: number[];
    benchmark?: number[];
    width: number;
    height: number;
}

interface ComputedChart {
    portfolioPoints: Point[];
    benchmarkPoints: Point[];
    yTicks: Array<{ value: number; y: number; label: string }>;
    baselineY: number;
    endDot: Point | null;
}

function computeChart({ data, benchmark, width, height }: ComputeArgs): ComputedChart {
    if (data.length === 0) {
        return {
            portfolioPoints: [],
            benchmarkPoints: [],
            yTicks: [],
            baselineY: height - PAD_BOTTOM,
            endDot: null,
        };
    }

    const allValues = benchmark && benchmark.length > 0 ? [...data, ...benchmark] : [...data];
    const dataMin = Math.min(...allValues);
    const dataMax = Math.max(...allValues);
    const yTicksRaw = niceTicks(dataMin, dataMax, 4);
    const yMin = yTicksRaw.length > 0 ? Math.min(...yTicksRaw) : dataMin;
    const yMax = yTicksRaw.length > 0 ? Math.max(...yTicksRaw) : dataMax;

    const xFor = (i: number, series: number[]): number => {
        if (series.length === 1) return PAD_LEFT + (width - PAD_LEFT - PAD_RIGHT) / 2;
        const t = i / (series.length - 1);
        return PAD_LEFT + t * (width - PAD_LEFT - PAD_RIGHT);
    };
    const yFor = (v: number): number =>
        linearScale(v, yMin, yMax, height - PAD_BOTTOM, PAD_TOP);

    const portfolioPoints: Point[] = data.map((v, i) => ({ x: xFor(i, data), y: yFor(v) }));
    const benchmarkPoints: Point[] =
        benchmark && benchmark.length > 0
            ? benchmark.map((v, i) => ({ x: xFor(i, benchmark), y: yFor(v) }))
            : [];

    const yTicks = yTicksRaw.map((value) => ({
        value,
        y: yFor(value),
        label: formatYLabel(value, yMax),
    }));

    return {
        portfolioPoints,
        benchmarkPoints,
        yTicks,
        baselineY: height - PAD_BOTTOM,
        endDot: portfolioPoints[portfolioPoints.length - 1] ?? null,
    };
}

function formatYLabel(value: number, yMax: number): string {
    // If the series looks like currency (large numbers), format as $Xk / $Xm.
    const absMax = Math.abs(yMax);
    if (absMax >= 1_000_000) return `$${fmt(value / 1_000_000)}m`;
    if (absMax >= 1_000) return `$${fmt(value / 1_000)}k`;
    if (absMax >= 10) return fmt(Math.round(value));
    return fmt(value);
}
