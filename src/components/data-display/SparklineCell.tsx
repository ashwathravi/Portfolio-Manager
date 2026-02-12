"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { cn } from "@/lib/utils";

interface SparklineCellProps {
    data: number[];
    color?: "success" | "danger" | "neutral";
    height?: number; // default 32px
    width?: number; // default 120px
    showValue?: boolean;
}

export function SparklineCell({
    data,
    color = "neutral",
    height = 32,
    width = 120,
}: SparklineCellProps) {
    // Determine color based on trend if not explicitly set
    // Or just use the prop. Spec says "Color coded by trend (green/red/gray)"
    // Let's infer trend from first vs last if color is 'neutral' and we want auto-coloring,
    // but the interface implies explicit control or we can compute it.
    // For now, let's map the 'color' prop to actual colors.

    const first = data[0] || 0;
    const last = data[data.length - 1] || 0;
    const isPositive = last >= first;

    let strokeColor = "#6b7280"; // neutral-500
    if (color === "success" || (color === "neutral" && isPositive)) strokeColor = "#10b981"; // success-500
    if (color === "danger" || (color === "neutral" && !isPositive)) strokeColor = "#ef4444"; // danger-500

    const chartData = data.map((val, i) => ({ i, val }));

    return (
        <div className="flex items-center" style={{ width, height }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                    <Line
                        type="monotone"
                        dataKey="val"
                        stroke={strokeColor}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false} // Disable animation for table performance
                    />
                    {/* Hidden YAxis to auto-scale nicely */}
                    <YAxis domain={["dataMin", "dataMax"]} hide />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
