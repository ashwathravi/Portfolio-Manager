"use client";

import { useMemo, type CSSProperties } from "react";
import { linearScale, niceTicks, fmt } from "@/lib/charts/scale";

/**
 * Phase 2 (AR-69) bar chart primitive.
 *
 * Vertical bars with positive/negative color split, anchored to a zero
 * line computed from the nice-tick y-domain. Used by Performance's
 * attribution-by-sector card and by Strategy Builder's monthly P&L.
 *
 * Value labels sit outside the bar (above for positive, below for
 * negative) so they never overlap the zero line.
 */

export interface BarDatum {
    label: string;
    value: number;
}

export interface BarChartProps {
    data: BarDatum[];
    /** viewBox width. Default 640. */
    width?: number;
    /** viewBox height. Default 220. */
    height?: number;
    /** Color for positive bars. Default `--pm-success`. */
    posColor?: string;
    /** Color for negative bars. Default `--pm-danger`. */
    negColor?: string;
    /** Show value labels on top/bottom of each bar. Default true. */
    showValueLabels?: boolean;
    /** Show bar-category labels along the x-axis. Default true. */
    showCategoryLabels?: boolean;
    /**
     * Formatter applied to each value label. Default: positive/negative
     * percent-point style (e.g. +2.1, −0.8) rounded to 1 decimal.
     */
    formatValue?: (v: number) => string;
    /** Accessible label. */
    ariaLabel?: string;
    className?: string;
    style?: CSSProperties;
}

const PAD_TOP = 20; // room for value labels above positive bars
const PAD_RIGHT = 12;
const PAD_BOTTOM = 32; // room for category labels + value labels below neg bars
const PAD_LEFT = 12;

export function BarChart({
    data,
    width = 640,
    height = 220,
    posColor = "var(--pm-success)",
    negColor = "var(--pm-danger)",
    showValueLabels = true,
    showCategoryLabels = true,
    formatValue,
    ariaLabel,
    className,
    style,
}: BarChartProps) {
    const computed = useMemo(
        () => compute(data, width, height),
        [data, width, height],
    );

    const fmtValue = formatValue ?? defaultFormatValue;

    if (data.length === 0) {
        return (
            <svg
                viewBox={`0 0 ${width} ${height}`}
                width="100%"
                height="auto"
                className={className}
                style={style}
                aria-label={ariaLabel}
                role={ariaLabel ? "img" : undefined}
                preserveAspectRatio="none"
            />
        );
    }

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            height="auto"
            className={className}
            style={style}
            aria-label={ariaLabel}
            role={ariaLabel ? "img" : undefined}
            preserveAspectRatio="none"
        >
            {/* Zero baseline */}
            <line
                x1={PAD_LEFT}
                x2={width - PAD_RIGHT}
                y1={computed.zeroY}
                y2={computed.zeroY}
                stroke="var(--pm-border-strong)"
                strokeWidth={1}
            />

            {computed.bars.map((bar, i) => (
                <g key={`${bar.label}-${i}`}>
                    <rect
                        x={bar.x}
                        y={bar.y}
                        width={bar.width}
                        height={bar.height}
                        fill={bar.value >= 0 ? posColor : negColor}
                        rx={2}
                        ry={2}
                    />
                    {showValueLabels && (
                        <text
                            x={bar.x + bar.width / 2}
                            y={bar.value >= 0 ? bar.y - 6 : bar.y + bar.height + 12}
                            textAnchor="middle"
                            fontSize={11}
                            fontFamily="var(--pm-font-mono, monospace)"
                            fill="var(--pm-fg)"
                        >
                            {fmtValue(bar.value)}
                        </text>
                    )}
                    {showCategoryLabels && (
                        <text
                            x={bar.x + bar.width / 2}
                            y={height - 8}
                            textAnchor="middle"
                            fontSize={11}
                            fill="var(--pm-fg-subtle)"
                        >
                            {bar.label}
                        </text>
                    )}
                </g>
            ))}
        </svg>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ComputedBar {
    label: string;
    value: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Computed {
    bars: ComputedBar[];
    zeroY: number;
}

function compute(data: BarDatum[], width: number, height: number): Computed {
    if (data.length === 0) {
        return { bars: [], zeroY: height - PAD_BOTTOM };
    }

    const values = data.map((d) => d.value);
    const min = Math.min(0, ...values); // always include zero line
    const max = Math.max(0, ...values);
    const ticks = niceTicks(min, max, 5);
    const yMin = ticks.length > 0 ? Math.min(...ticks) : min;
    const yMax = ticks.length > 0 ? Math.max(...ticks) : max;
    const yFor = (v: number): number =>
        linearScale(v, yMin, yMax, height - PAD_BOTTOM, PAD_TOP);

    const zeroY = yFor(0);

    // Distribute bars evenly with a small gap between them.
    const slotWidth = (width - PAD_LEFT - PAD_RIGHT) / data.length;
    const barWidth = slotWidth * 0.7;

    const bars: ComputedBar[] = data.map((d, i) => {
        const x = PAD_LEFT + i * slotWidth + (slotWidth - barWidth) / 2;
        const barY = yFor(d.value);
        const y = d.value >= 0 ? barY : zeroY;
        const h = Math.max(1, Math.abs(barY - zeroY));
        return {
            label: d.label,
            value: d.value,
            x,
            y,
            width: barWidth,
            height: h,
        };
    });

    return { bars, zeroY };
}

function defaultFormatValue(v: number): string {
    const sign = v > 0 ? "+" : v < 0 ? "−" : "";
    return `${sign}${fmt(Math.abs(Math.round(v * 10) / 10))}`;
}
