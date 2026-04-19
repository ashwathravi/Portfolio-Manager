
import { Suspense } from 'react';
import { db } from '@/db';
import { holdings } from '@/db/schema';
import { HoldingsTable, Holding } from '@/components/holdings/HoldingsTable';
import { mockPortfolios } from '@/lib/mockData';
import { marketDataEngine } from '@/lib/api/market-data';
import HoldingsLoading from './loading';

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
            symbol: h.symbol ?? h.ticker,
            name: h.name,
            price: h.currentPrice,
            quantity: Number(h.quantity),
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

    // Try to fetch live quotes for all symbols in the portfolio
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let liveQuotes: Record<string, any> = {};
    try {
        const symbols = Array.from(new Set<string>(dbHoldings.map((h: any) => h.symbol).filter(Boolean)));
        if (symbols.length > 0) {
            liveQuotes = await marketDataEngine.getQuotes(symbols);
        }
    } catch (e) {
        console.warn('Failed to fetch live quotes, falling back to DB values', e);
    }

    // Transform to component properties
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformedHoldings: Holding[] = dbHoldings.map((h: any) => {
        // Calculate missing fields, preferring live quote if available
        const qty = Number(h.quantity);
        const avg = Number(h.avgCost);
        const currentPrice = liveQuotes[h.symbol]?.price ?? h.currentPrice ?? 0;
        const marketValue = h.marketValue || (qty * currentPrice);
        const costBasis = qty * avg;
        const totalReturn = marketValue - costBasis;
        const returnPercentage = costBasis !== 0 ? (totalReturn / costBasis) * 100 : 0;

        return {
            id: h.id,
            symbol: h.symbol,
            name: h.name,
            price: currentPrice,
            quantity: qty,
            totalValue: marketValue,
            avgCost: avg,
            totalReturn: totalReturn,
            returnPercentage: returnPercentage,
            trend: [currentPrice * 0.9, currentPrice * 0.95, currentPrice * 1.05, currentPrice], // Mock trend
            account: h.portfolio?.name || 'Unknown Portfolio',
            strategy: h.portfolio?.description || 'General', // Fallback
            tags: [], // No tags in DB yet
        };
    });

    if (transformedHoldings.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                <div className="text-4xl">📭</div>
                <h3 className="text-xl font-semibold">No holdings yet</h3>
                <p className="text-muted-foreground max-w-sm">
                    Your holdings will appear here once you add positions to a portfolio.
                </p>
            </div>
        );
    }

    return <HoldingsTable holdings={transformedHoldings} />;
}

export default function CurrentHoldingsPage() {
    return (
        <Suspense fallback={<HoldingsLoading />}>
            <HoldingsContent />
        </Suspense>
    );
}
