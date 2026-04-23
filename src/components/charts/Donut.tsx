"use client";

import { type CSSProperties, type ReactNode } from "react";
import { buildDonutSegment } from "@/lib/charts/scale";

/**
 * Phase 2 (AR-69) donut chart primitive.
 *
 * Used by Dashboard's Allocation card (sector/account breakdown) and by
 * any future "share of X" visualization. Segment colors are supplied by
 * the caller — we don't infer a palette, because the Ledger design system
 * wants explicit, contrast-tested swatches per surface.
 *
 * Rendering notes:
 *   - Neutral outer track draws underneath the segments so a partial
 *     donut still reads as "the rest is empty".
 *   - Center area hosts a caller-supplied label (usually "100% / N groups").
 *   - Zero-value segments are skipped — their placeholder space is absorbed
 *     by the neighbors.
 */

export interface DonutSegment {
    name: string;
    value: number;
    color: string;
}

export interface DonutProps {
    segments: DonutSegment[];
    /** Outer diameter (and viewBox side length). Default 180. */
    size?: number;
    /** Ring thickness in px. Default 22. */
    thickness?: number;
    /** Content rendered centered inside the donut. */
    centerLabel?: ReactNode;
    /** Accessible label for the whole chart. */
    ariaLabel?: string;
    className?: string;
    style?: CSSProperties;
}

export function Donut({
    segments,
    size = 180,
    thickness = 22,
    centerLabel,
    ariaLabel,
    className,
    style,
}: DonutProps) {
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 2; // 2px inset so the ring stays inside viewBox
    const innerR = Math.max(4, outerR - thickness);

    const positive = segments.filter((s) => s.value > 0);
    const total = positive.reduce((sum, s) => sum + s.value, 0);

    return (
        <div
            className={className}
            style={{ position: "relative", width: size, height: size, ...style }}
            aria-label={ariaLabel}
            role={ariaLabel ? "img" : undefined}
        >
            <svg
                viewBox={`0 0 ${size} ${size}`}
                width={size}
                height={size}
                aria-hidden={!ariaLabel}
            >
                {/* Neutral outer track — sits behind the segments. */}
                <circle
                    cx={cx}
                    cy={cy}
                    r={(outerR + innerR) / 2}
                    fill="none"
                    stroke="var(--pm-bg-2)"
                    strokeWidth={outerR - innerR}
                />

                {total > 0 &&
                    (() => {
                        let acc = 0;
                        return positive.map((seg, i) => {
                            const start = (acc / total) * Math.PI * 2;
                            acc += seg.value;
                            const end = (acc / total) * Math.PI * 2;
                            const d = buildDonutSegment(cx, cy, outerR, innerR, start, end);
                            return (
                                <path
                                    key={`${seg.name}-${i}`}
                                    d={d}
                                    fill={seg.color}
                                    stroke="var(--pm-card)"
                                    strokeWidth={1}
                                    strokeLinejoin="round"
                                />
                            );
                        });
                    })()}
            </svg>

            {centerLabel != null && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        pointerEvents: "none",
                        textAlign: "center",
                    }}
                >
                    {centerLabel}
                </div>
            )}
        </div>
    );
}
