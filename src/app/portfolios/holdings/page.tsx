
import { Suspense } from 'react';
import { db } from '@/db';
import { holdings } from '@/db/schema';
import { HoldingsTable, Holding } from '@/components/holdings/HoldingsTable';
import { mockPortfolios } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

async function HoldingsContent() {
    let dbHoldings = [];
    try {
        // Fetch holdings with portfolio relation
        dbHoldings = await db.query.holdings.findMany({
            with: {
                portfolio: true,
            },
        });
    } catch (error) {
        console.warn('Database fetch failed, using mock data:', error);
        // Fallback to mock data
        const mockHoldings: Holding[] = mockPortfolios.flatMap(p => (p.holdings || []).map(h => ({
            id: h.id,
            symbol: h.ticker,
            name: h.name,
            price: h.currentPrice,
            quantity: h.quantity,
            totalValue: h.marketValue,
            avgCost: h.avgCost,
            totalReturn: h.totalReturn,
            returnPercentage: h.totalReturnPercent,
            trend: [h.currentPrice * 0.9, h.currentPrice * 0.95, h.currentPrice * 1.05, h.currentPrice], // Mock trend
            account: p.name,
            strategy: p.description || 'General',
            tags: [],
        })));
        return <HoldingsTable holdings={mockHoldings} />;
    }

    // Transform to component properties
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformedHoldings: Holding[] = dbHoldings.map((h: any) => {
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
            account: h.portfolio?.name || 'Unknown Portfolio',
            strategy: h.portfolio?.description || 'General', // Fallback
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
