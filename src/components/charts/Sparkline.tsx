"use client";

import { useId, useMemo, type CSSProperties } from "react";
import {
    linearScale,
    buildLinePath,
    buildAreaPath,
    type Point,
} from "@/lib/charts/scale";

/**
 * Phase 2 (AR-69) sparkline primitive.
 *
 * Tiny inline chart, zero axis chrome, used in:
 *   - SidebarMarketCard indices rows
 *   - Dashboard top-holdings 30d trend column
 *   - Research thesis list rows (price since open)
 *   - StatCard trend indicator (<issue id="AR-70">AR-70</issue>)
 *
 * Defaults to a filled area with a thin stroke. If the series is empty or
 * constant, we still render the box so layout doesn't jump — a constant
 * series draws as a flat horizontal line at the middle of the box.
 */

export interface SparklineProps {
    /** Series values. Length ≥ 1 renders something; empty renders an empty box. */
    data: number[];
    /** Width in px (also viewBox width). Default 80. */
    width?: number;
    /** Height in px (also viewBox height). Default 24. */
    height?: number;
    /** Stroke / fill base color. Default `--pm-accent`. */
    color?: string;
    /** Line thickness. Default 1.5. */
    strokeWidth?: number;
    /** Show a filled area beneath the line. Default true. */
    fill?: boolean;
    /**
     * Auto-color positive vs. negative based on first→last delta: pos =
     * `--pm-success`, neg = `--pm-danger`. Overrides `color` when true.
     */
    autoColor?: boolean;
    /** Accessible label (e.g. "AAPL 30 day trend: +4.2%"). */
    ariaLabel?: string;
    /** Smooth curve. Default true. */
    smooth?: boolean;
    className?: string;
    style?: CSSProperties;
}

const PAD = 2; // keep the stroke off the edge so the 1.5-wide line doesn't clip

export function Sparkline({
    data,
    width = 80,
    height = 24,
    color,
    strokeWidth = 1.5,
    fill = true,
    autoColor = false,
    ariaLabel,
    smooth = true,
    className,
    style,
}: SparklineProps) {
    const uid = useId();
    const gradId = `pm-spark-grad-${uid}`;

    const points = useMemo(() => computePoints(data, width, height), [data, width, height]);

    const resolvedColor = useMemo(() => {
        if (!autoColor) return color ?? "var(--pm-accent)";
        if (data.length < 2) return color ?? "var(--pm-accent)";
        const first = data[0]!;
        const last = data[data.length - 1]!;
        return last >= first ? "var(--pm-success)" : "var(--pm-danger)";
    }, [autoColor, color, data]);

    if (points.length === 0) {
        return (
            <svg
                viewBox={`0 0 ${width} ${height}`}
                width={width}
                height={height}
                className={className}
                style={style}
                role={ariaLabel ? "img" : undefined}
                aria-label={ariaLabel}
                aria-hidden={!ariaLabel}
            />
        );
    }

    const baselineY = height - PAD;

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className={className}
            style={style}
            role={ariaLabel ? "img" : undefined}
            aria-label={ariaLabel}
            aria-hidden={!ariaLabel}
            preserveAspectRatio="none"
        >
            {fill && (
                <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={resolvedColor} stopOpacity="0.28" />
                        <stop offset="100%" stopColor={resolvedColor} stopOpacity="0" />
                    </linearGradient>
                </defs>
            )}

            {fill && (
                <path
                    d={buildAreaPath(points, baselineY, smooth)}
                    fill={`url(#${gradId})`}
                    stroke="none"
                />
            )}

            <path
                d={buildLinePath(points, smooth)}
                fill="none"
                stroke={resolvedColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function computePoints(data: number[], width: number, height: number): Point[] {
    if (data.length === 0) return [];
    const min = Math.min(...data);
    const max = Math.max(...data);
    // Clamp to the inner box (account for stroke padding both sides).
    const xFor = (i: number): number => {
        if (data.length === 1) return width / 2;
        const t = i / (data.length - 1);
        return PAD + t * (width - PAD * 2);
    };
    const yFor = (v: number): number =>
        linearScale(v, min, max, height - PAD, PAD);
    return data.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
}
