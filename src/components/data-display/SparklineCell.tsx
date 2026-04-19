"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { calculateSparklinePoints } from "@/lib/charts";

interface SparklineCellProps {
    data: number[];
    color?: "success" | "danger" | "neutral" | "primary";
    height?: number; // default 32px
    width?: number; // default 120px
    className?: string;
    showValue?: boolean;
}

export function SparklineCell({
    data,
    color = "neutral",
    height = 32,
    width = 120,
    className,
}: SparklineCellProps) {
    const points = useMemo(() => {
        // Keep original behavior of not showing anything for < 2 points
        // calculateSparklinePoints can handle 1 point (returns a dot), but we stick to current behavior
        if (!data || data.length < 2) return "";

        // Pass height * 0.15 as padding to match original implementation
        return calculateSparklinePoints(data, width, height, height * 0.15);
    }, [data, height, width]);

    const first = data[0] || 0;
    const last = data[data.length - 1] || 0;
    const isPositive = last >= first;

    let strokeColorClass = "text-muted-foreground";
    if (color === "success" || (color === "neutral" && isPositive)) strokeColorClass = "text-primary";
    if (color === "danger" || (color === "neutral" && !isPositive)) strokeColorClass = "text-destructive";
    if (color === "primary") strokeColorClass = "text-primary";

    return (
        <svg
            width={width}
            height={height}
            className={cn(strokeColorClass, className)}
            viewBox={`0 0 ${width} ${height}`}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
