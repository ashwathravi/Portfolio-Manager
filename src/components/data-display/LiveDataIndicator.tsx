'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LiveDataIndicatorProps {
    isFetching: boolean;
    isError: boolean;
    refreshMs: number;
    lastUpdatedAt: number | null;
    onRefresh: () => void;
    className?: string;
}

function formatRelative(fromMs: number): string {
    const diff = Math.max(0, Math.floor((Date.now() - fromMs) / 1000));
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

export function LiveDataIndicator({
    isFetching,
    isError,
    refreshMs,
    lastUpdatedAt,
    onRefresh,
    className,
}: LiveDataIndicatorProps) {
    // Re-render every 10s so the "updated Xs ago" label stays fresh.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), 10_000);
        return () => clearInterval(id);
    }, []);

    const refreshLabel = `${Math.round(refreshMs / 1000)}s`;

    return (
        <div
            className={cn(
                'flex items-center gap-3 text-xs text-muted-foreground',
                className,
            )}
            role="status"
            aria-live="polite"
        >
            {isError ? (
                <span className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Live quotes unavailable — showing last known values</span>
                </span>
            ) : isFetching ? (
                <span className="flex items-center gap-1.5 text-primary">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    <span>Refreshing…</span>
                </span>
            ) : lastUpdatedAt ? (
                <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    <span>
                        Live · updated {formatRelative(lastUpdatedAt)} · auto-refresh every {refreshLabel}
                    </span>
                </span>
            ) : (
                <span>Auto-refresh every {refreshLabel}</span>
            )}
            <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onRefresh}
                disabled={isFetching}
                aria-label="Refresh live data now"
            >
                <RefreshCw
                    className={cn('h-3.5 w-3.5 mr-1', isFetching && 'animate-spin')}
                    aria-hidden="true"
                />
                Refresh now
            </Button>
        </div>
    );
}
