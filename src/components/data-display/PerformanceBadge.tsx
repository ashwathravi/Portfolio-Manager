import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";

interface PerformanceBadgeProps {
    value: number; // percentage
    label?: string;
    size?: "sm" | "md" | "lg";
    showArrow?: boolean;
    format?: "percent" | "decimal";
    className?: string; // Added for flexibility
}

export function PerformanceBadge({
    value,
    label,
    size = "md",
    showArrow = true,
    format = "percent",
    className,
}: PerformanceBadgeProps) {
    const isPositive = value > 0;
    const isNegative = value < 0;

    let colorClass = "bg-muted text-muted-foreground";
    if (isPositive) colorClass = "bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-400";
    if (isNegative) colorClass = "bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400";

    const sizeClass = {
        sm: "text-xs px-1.5 py-0.5",
        md: "text-sm px-2 py-1",
        lg: "text-base px-2.5 py-1.5",
    };

    const formattedValue =
        format === "percent"
            ? `${Math.abs(value).toFixed(2)}%`
            : Math.abs(value).toFixed(2);

    return (
        <span
            className={cn(
                "inline-flex items-center justify-center rounded-full font-medium transition-colors",
                colorClass,
                sizeClass[size],
                className
            )}
        >
            {showArrow && isPositive && <ArrowUp className="mr-1 size-3" />}
            {showArrow && isNegative && <ArrowDown className="mr-1 size-3" />}
            {label && <span className="mr-1">{label}</span>}
            {formattedValue}
        </span>
    );
}
