'use client';

import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useQuotesQuery } from '@/lib/api/market-data/queries';

export interface WatchlistItem {
    id: string;
    ticker: string;
    companyName: string;
    reason: string;
    dateAdded: string;
    currentPrice: number;
    targetEntry: number;
    notes: string;
}

export function WatchlistSection({ items }: { items: readonly WatchlistItem[] }) {
    const router = useRouter();
    const symbols = useMemo(() => items.map((i) => i.ticker), [items]);
    const { data: quotes, isFetching, isError } = useQuotesQuery(symbols, {
        // Refresh live quotes every 60s while the watchlist tab is visible
        refetchInterval: 60_000,
        staleTime: 30_000,
    });

    const resolvePrice = (item: WatchlistItem) => {
        const live = quotes?.[item.ticker.toUpperCase()];
        if (live && Number.isFinite(live.price)) {
            return { price: live.price, isLive: true };
        }
        return { price: item.currentPrice, isLive: false };
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isFetching && <span>Refreshing live quotes…</span>}
                {isError && (
                    <span className="text-destructive">
                        Live quotes unavailable — showing last-known prices.
                    </span>
                )}
                {!isFetching && !isError && quotes && (
                    <span>Live prices auto-refresh every 60 seconds.</span>
                )}
            </div>
            {items.map((item) => {
                const { price, isLive } = resolvePrice(item);
                const distancePct = price > 0 ? ((item.targetEntry - price) / price) * 100 : 0;
                return (
                    <Card key={item.id} className="p-6 transition-all hover:shadow-md">
                        <div className="flex items-start justify-between">
                            <div className="flex-1 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                        <span className="text-sm font-bold">{item.ticker.slice(0, 2)}</span>
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg">{item.ticker}</h3>
                                        <p className="text-sm text-muted-foreground">{item.companyName}</p>
                                    </div>
                                </div>

                                <div>
                                    <p className="font-medium mb-1">{item.reason}</p>
                                    <p className="text-sm text-muted-foreground">{item.notes}</p>
                                </div>

                                <div className="grid grid-cols-3 gap-4 pt-2">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <p className="text-xs text-muted-foreground">Current Price</p>
                                            {isLive && (
                                                <span
                                                    className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse"
                                                    aria-label="Live quote"
                                                />
                                            )}
                                        </div>
                                        <p className="font-bold">${price.toFixed(2)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground mb-1">Target Entry</p>
                                        <p className="font-bold text-primary">${item.targetEntry.toFixed(2)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-muted-foreground mb-1">Distance</p>
                                        <p className={`font-bold ${price > item.targetEntry ? 'text-destructive' : 'text-primary'}`}>
                                            {distancePct.toFixed(1)}%
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                                <Badge variant="secondary" className="whitespace-nowrap">
                                    Added {item.dateAdded}
                                </Badge>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => router.push(`/research/thesis/${item.ticker}`)}
                                >
                                    <Eye className="h-4 w-4 mr-2" />
                                    View Details
                                </Button>
                            </div>
                        </div>
                    </Card>
                );
            })}
        </div>
    );
}
