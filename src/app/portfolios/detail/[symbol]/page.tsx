import { Suspense } from 'react';
import { db } from '@/db';
import { holdings } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { marketDataEngine } from '@/lib/api/market-data';
import { HoldingDetailView, type HoldingDetail, type AccountPosition } from '@/components/holdings/HoldingDetailView';

export const dynamic = 'force-dynamic';

async function HoldingDetailContent({ symbol }: { symbol: string }) {
    const upper = symbol.toUpperCase();

    let rows: Array<{
        id: string;
        portfolioId: string;
        quantity: string;
        avgCost: string;
        name: string;
        currentPrice: number | null;
        portfolio: { id: string; name: string | null } | null;
    }> = [];

    try {
        // Case-insensitive match so URL /detail/aapl and /detail/AAPL both work
        rows = await db.query.holdings.findMany({
            where: sql`upper(${holdings.symbol}) = ${upper}`,
            with: { portfolio: true },
        }) as typeof rows;
    } catch (error) {
        console.warn('Holding detail DB fetch failed:', error);
    }

    if (rows.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                <div className="text-4xl">🔍</div>
                <h3 className="text-xl font-semibold">No holdings for {upper}</h3>
                <p className="text-muted-foreground max-w-sm">
                    This symbol isn&apos;t currently in any of your portfolios.
                </p>
            </div>
        );
    }

    // Try live quote; fall back to the last-known snapshot from the DB.
    let livePrice: number | undefined;
    let liveChange = 0;
    let liveChangePercent = 0;
    try {
        const quotes = await marketDataEngine.getQuotes([upper]);
        if (quotes[upper]) {
            livePrice = quotes[upper].price;
            liveChange = quotes[upper].change ?? 0;
            liveChangePercent = quotes[upper].changePercent ?? 0;
        }
    } catch (e) {
        console.warn(`Failed to fetch live quote for ${upper}:`, e);
    }

    const firstRow = rows[0];
    const currentPrice = livePrice ?? firstRow.currentPrice ?? Number(firstRow.avgCost);

    // Aggregate across accounts (portfolios) to get per-symbol totals and cost basis
    let totalShares = 0;
    let totalCostBasis = 0;
    const accountPositions: AccountPosition[] = rows.map((h) => {
        const qty = Number(h.quantity);
        const avg = Number(h.avgCost);
        const value = qty * currentPrice;
        const cost = qty * avg;
        totalShares += qty;
        totalCostBasis += cost;
        return {
            portfolioId: h.portfolioId,
            name: h.portfolio?.name ?? 'Unknown Portfolio',
            shares: qty,
            avgCost: avg,
            value,
            gain: value - cost,
        };
    });

    const totalEquity = totalShares * currentPrice;
    const totalReturn = totalEquity - totalCostBasis;
    const blendedAvgCost = totalShares > 0 ? totalCostBasis / totalShares : 0;
    const returnPercent = totalCostBasis > 0 ? (totalReturn / totalCostBasis) * 100 : 0;

    const detail: HoldingDetail = {
        symbol: upper,
        name: firstRow.name,
        price: currentPrice,
        change: liveChange,
        changePercent: liveChangePercent,
        totalShares,
        totalEquity,
        avgCost: blendedAvgCost,
        costBasis: totalCostBasis,
        totalReturn,
        returnPercent,
        accounts: accountPositions,
        priceHistory: [],
    };

    return <HoldingDetailView holding={detail} />;
}

export default async function PortfolioDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;
    return (
        <Suspense fallback={<div className="p-6">Loading…</div>}>
            <HoldingDetailContent symbol={symbol} />
        </Suspense>
    );
}
