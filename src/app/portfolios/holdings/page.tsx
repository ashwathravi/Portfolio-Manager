
import { Suspense } from 'react';
import { db } from '@/db';
import { holdings } from '@/db/schema';
import { HoldingsTable, Holding } from '@/components/holdings/HoldingsTable';

export const dynamic = 'force-dynamic';

async function HoldingsContent() {
    // Fetch holdings with portfolio relation
    const dbHoldings = await db.query.holdings.findMany({
        with: {
            portfolio: true,
        },
    });

    // Transform to component properties
    const transformedHoldings: Holding[] = dbHoldings.map(h => {
        // Calculate missing fields
        const currentPrice = h.currentPrice || 0;
        const marketValue = h.marketValue || (h.quantity * currentPrice);
        const costBasis = h.quantity * h.avgCost;
        const totalReturn = marketValue - costBasis;
        const returnPercentage = costBasis !== 0 ? (totalReturn / costBasis) * 100 : 0;

        return {
            id: h.id,
            symbol: h.ticker,
            name: h.name,
            price: currentPrice,
            quantity: h.quantity,
            totalValue: marketValue,
            avgCost: h.avgCost,
            totalReturn: totalReturn,
            returnPercentage: returnPercentage,
            trend: [currentPrice * 0.9, currentPrice * 0.95, currentPrice * 1.05, currentPrice], // Mock trend
            account: h.portfolio.name,
            strategy: h.portfolio.description || 'General', // Fallback
            tags: [], // No tags in DB yet
        };
    });

    return <HoldingsTable holdings={transformedHoldings} />;
}

export default function CurrentHoldingsPage() {
    return (
        <Suspense fallback={<div>Loading holdings...</div>}>
            <HoldingsContent />
        </Suspense>
    );
}
