'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEasternDate } from '@/lib/hooks/useEasternDate';
import { describeQuotes } from '@/lib/markets/quote-label';
import { cn } from '@/lib/utils';
import type { Quote } from '@/types/market-data';

interface LiveDataIndicatorProps {
    isFetching: boolean;
    isError: boolean;
    refreshMs: number;
    lastUpdatedAt: number | null;
    onRefresh: () => void;
    /** The prices on show, so the line says what they are: delayed quotes or closes (launch item i33). */
    quotes?: Readonly<Record<string, Pick<Quote, 'kind' | 'timestamp'>>>;
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

/**
 * The page's price freshness line. Atlas has no real-time feed, so it says
 * what the prices are (delayed quotes with their time, or closes with their
 * date) and when it last checked for newer ones; never "live".
 */
export function LiveDataIndicator({
    isFetching,
    isError,
    refreshMs,
    lastUpdatedAt,
    onRefresh,
    quotes,
    className,
}: LiveDataIndicatorProps) {
    // Re-render every 10s so the "checked Xs ago" label stays fresh.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), 10_000);
        return () => clearInterval(id);
    }, []);

    const today = useEasternDate();
    const summary = useMemo(() => (quotes ? describeQuotes(Object.values(quotes), today) : null), [quotes, today]);
    const refreshLabel = `${Math.round(refreshMs / 1000)}s`;

    return (
        <div
            className={cn(
                'flex items-center gap-3 text-xs text-muted-foreground',
                className,
            )}
            role="status"
            aria-live="polite"
            data-testid="price-freshness"
        >
            {isError ? (
                <span className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Prices unavailable — showing the last ones Atlas stored</span>
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
                        {summary ?? 'Prices stored with your holdings'} · checked {formatRelative(lastUpdatedAt)} · auto-refresh every {refreshLabel}
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
                aria-label="Refresh prices now"
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
