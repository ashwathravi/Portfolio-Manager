import React from 'react';
import { cn } from '@/lib/utils';

export interface MetricCardProps {
    title: string;
    tooltip?: string;
    value?: React.ReactNode;
    valueClassName?: string;
    description?: React.ReactNode;
    children?: React.ReactNode;
    className?: string;
}

export function MetricCard({
    title,
    tooltip,
    value,
    valueClassName,
    description,
    children,
    className,
}: MetricCardProps) {
    return (
        <div className={cn("flex flex-col p-5 rounded-xl bg-card border border-border", className)}>
            <div className="flex items-center justify-between mb-3">
                <p className="text-muted-foreground text-xs font-medium">{title}</p>
                {tooltip && (
                    <button
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title={tooltip}
                    >
                        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M8 7V11M8 5V5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        <span className="sr-only">Information about {title}</span>
                    </button>
                )}
            </div>

            {value !== undefined && (
                <div className="flex items-baseline gap-2 mb-2">
                    {typeof value === 'string' || typeof value === 'number' ? (
                        <h3 className={cn("text-2xl font-bold", valueClassName)}>
                            {value}
                        </h3>
                    ) : (
                        value
                    )}
                </div>
            )}

            {children}

            {description && (
                <div className="text-xs text-muted-foreground mt-auto">
                    {description}
                </div>
            )}
        </div>
    );
}
