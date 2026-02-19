import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

interface StatCardProps {
    label?: string; // Unified prop for title/label
    title?: string; // Alias for label (support dashboard usage)
    value: string | number;
    change?: number;
    changeLabel?: string;
    subtitle?: string; // Alias for changeLabel (support dashboard usage)
    icon?: React.ReactNode;
    color?: "primary" | "success" | "danger" | "warning" | "info";
    trend?: "up" | "down" | "neutral";
    loading?: boolean;
    className?: string; // Support custom className from dashboard usage
}

export function StatCard({
    label,
    title,
    value,
    change,
    changeLabel,
    subtitle,
    icon,
    color = "primary",
    trend,
    loading,
    className,
}: StatCardProps) {
    // Resolve aliases
    const displayLabel = label || title;
    const displaySubtitle = changeLabel || subtitle;

    // Determine trend state if not explicitly provided
    const calculatedTrend = trend || (change && change > 0 ? "up" : change && change < 0 ? "down" : "neutral");

    const trendColor =
        calculatedTrend === "up"
            ? "text-success-600 text-green-600"
            : calculatedTrend === "down"
                ? "text-danger-600 text-red-600"
                : "text-muted-foreground";

    const TrendIcon =
        calculatedTrend === "up" ? ArrowUp : calculatedTrend === "down" ? ArrowDown : Minus;

    const trendText =
        calculatedTrend === "up"
            ? "Up by "
            : calculatedTrend === "down"
                ? "Down by "
                : "Change of ";

    return (
        <Card className={cn("overflow-hidden transition-all hover:shadow-md", className)}>
            <CardContent className="p-6 relative">
                <div className="flex items-start justify-between">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{displayLabel}</p>
                        <h3 className="mt-2 text-3xl font-bold tracking-tight">{value}</h3>
                    </div>
                    {icon && (
                        <div className={cn("rounded-full p-2.5 bg-muted/50 text-muted-foreground", color === "primary" && "text-primary bg-primary/10")}>
                            {icon}
                        </div>
                    )}
                </div>
                {(change !== undefined || displaySubtitle) && (
                    <div className="mt-4 flex items-center text-sm">
                        {change !== undefined && (
                            <span
                                className={cn(
                                    "flex items-center font-medium mr-2",
                                    trendColor,
                                    // Add background style similar to dashboard StatCard if desired
                                    "px-1.5 py-0.5 rounded bg-muted/20"
                                )}
                            >
                                <TrendIcon className="mr-1 size-3" aria-hidden="true" />
                                <span className="sr-only">{trendText}</span>
                                {Math.abs(change)}%
                            </span>
                        )}
                        <span className="text-muted-foreground text-xs">
                            {displaySubtitle || "vs last month"}
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
