"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

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
        if (!data || data.length < 2) return "";

        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;

        // Add padding to prevent lines from touching the edges (15% top/bottom)
        const padding = height * 0.15;
        const drawHeight = height - (padding * 2);

        return data
            .map((val, i) => {
                const x = (i / (data.length - 1)) * width;
                // Invert Y axis: 0 is top, height is bottom
                // Value: min -> height-padding, max -> padding
                const y = (height - padding) - ((val - min) / range) * drawHeight;
                return `${x},${y}`;
            })
            .join(" ");
    }, [data, height, width]);

    const first = data[0] || 0;
    const last = data[data.length - 1] || 0;
    const isPositive = last >= first;

    let strokeColorClass = "text-muted-foreground";
    if (color === "success" || (color === "neutral" && isPositive)) strokeColorClass = "text-emerald-500";
    if (color === "danger" || (color === "neutral" && !isPositive)) strokeColorClass = "text-red-500";
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
