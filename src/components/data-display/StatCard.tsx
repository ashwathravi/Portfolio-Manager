import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

interface StatCardProps {
    label: string;
    value: string | number;
    change?: number;
    changeLabel?: string;
    icon?: React.ReactNode;
    color?: "primary" | "success" | "danger" | "warning" | "info";
    trend?: "up" | "down" | "neutral";
    loading?: boolean;
}

export function StatCard({
    label,
    value,
    change,
    changeLabel,
    icon,
    color = "primary",
    trend,
}: StatCardProps) {
    const trendColor =
        change && change > 0
            ? "text-success-600"
            : change && change < 0
                ? "text-danger-600"
                : "text-muted-foreground";

    const TrendIcon =
        change && change > 0 ? ArrowUp : change && change < 0 ? ArrowDown : Minus;

    return (
        <Card className="overflow-hidden transition-all hover:shadow-md">
            <CardContent className="p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">{label}</p>
                        <h3 className="mt-2 text-3xl font-bold tracking-tight">{value}</h3>
                    </div>
                    {icon && (
                        <div className={cn("rounded-full p-2.5 bg-muted/50", `text-${color}-500`)}>
                            {icon}
                        </div>
                    )}
                </div>
                {(change !== undefined || changeLabel) && (
                    <div className="mt-4 flex items-center text-sm">
                        <span
                            className={cn(
                                "flex items-center font-medium",
                                trend === "up" ? "text-success-600" : trend === "down" ? "text-danger-600" : "text-muted-foreground",
                                !trend && trendColor
                            )}
                        >
                            <TrendIcon className="mr-1 size-4" />
                            {change && Math.abs(change)}%
                        </span>
                        <span className="ml-2 text-muted-foreground">
                            {changeLabel || "vs last month"}
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
