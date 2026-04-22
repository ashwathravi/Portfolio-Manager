'use client';

import { useMemo } from 'react';
import { HoldingsTable, type Holding } from './HoldingsTable';
import { useAutoRefreshQuotes } from '@/lib/hooks/useAutoRefreshQuotes';
import { LiveDataIndicator } from '@/components/data-display/LiveDataIndicator';

interface HoldingsTableLiveProps {
    initialHoldings: Holding[];
    costBasisBySymbol: Record<string, { quantity: number; avgCost: number }>;
}

/**
 * Client wrapper that merges auto-refreshed live quotes into the server-rendered
 * holdings snapshot. The indicator is rendered above the table and a floor of
 * 15s is applied via `useAutoRefreshQuotes` to respect provider rate limits.
 */
export function HoldingsTableLive({ initialHoldings, costBasisBySymbol }: HoldingsTableLiveProps) {
    const symbols = useMemo(
        () => initialHoldings.map((h) => h.symbol).filter(Boolean),
        [initialHoldings],
    );

    const { quotes, isFetching, isError, refreshMs, refetch, lastUpdatedAt } =
        useAutoRefreshQuotes(symbols);

    const liveHoldings = useMemo<Holding[]>(() => {
        return initialHoldings.map((h) => {
            const quote = quotes[h.symbol.toUpperCase()];
            if (!quote || !Number.isFinite(quote.price)) return h;

            const basis = costBasisBySymbol[h.symbol] ?? {
                quantity: h.quantity,
                avgCost: h.avgCost,
            };
            const totalValue = basis.quantity * quote.price;
            const costBasis = basis.quantity * basis.avgCost;
            const totalReturn = totalValue - costBasis;
            const returnPercentage = costBasis !== 0 ? (totalReturn / costBasis) * 100 : 0;

            return {
                ...h,
                price: quote.price,
                totalValue,
                totalReturn,
                returnPercentage,
            };
        });
    }, [initialHoldings, quotes, costBasisBySymbol]);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-end px-6 pt-4">
                <LiveDataIndicator
                    isFetching={isFetching}
                    isError={isError}
                    refreshMs={refreshMs}
                    lastUpdatedAt={lastUpdatedAt}
                    onRefresh={() => refetch()}
                />
            </div>
            <HoldingsTable holdings={liveHoldings} />
        </div>
    );
}
