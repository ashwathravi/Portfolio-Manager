import { Suspense } from 'react';
import { marketDataEngine } from '@/lib/api/market-data';
import { requirePageUserId } from '@/lib/auth/request-user';
import { buildUserHoldingPositionsQuery } from '@/lib/portfolio-repository';
import { HoldingDetailView, type HoldingDetail, type AccountPosition } from '@/components/holdings/HoldingDetailView';
import { PageHeaderSync } from '@/components/layout/TopBar';

export const dynamic = 'force-dynamic';

async function HoldingDetailContent({ symbol }: { symbol: string }) {
    const upper = symbol.toUpperCase();
    const userId = await requirePageUserId();

    let rows: Array<{
        id: string;
        portfolioId: string;
        quantity: string;
        avgCost: string;
        name: string;
        currentPrice: number | null;
        portfolioName: string;
    }> = [];

    try {
        // Case-insensitive match so URL /detail/aapl and /detail/AAPL both work
        rows = await buildUserHoldingPositionsQuery(userId, upper);
    } catch (error) {
        console.warn('Holding detail DB fetch failed:', error);
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

    const quote = livePrice === undefined ? null : { price: livePrice, change: liveChange, changePercent: liveChangePercent };
    const header = (
        <PageHeaderSync
            title={upper}
            subtitle={rows[0]?.name ?? "Position detail"}
            crumbs={["Portfolio", "Holdings", upper]}
        />
    );

    if (rows.length === 0) {
        return (
            <>
                {header}
                <HoldingDetailView symbol={upper} holding={null} quote={quote} />
            </>
        );
    }

    const firstRow = rows[0];
    const currentPrice = livePrice ?? firstRow.currentPrice ?? Number(firstRow.avgCost);

    // Aggregate across accounts (portfolios) to get per-symbol totals and cost basis
    const accountPositions: AccountPosition[] = rows.map((h) => {
        const qty = Number(h.quantity);
        const avg = Number(h.avgCost);
        const value = qty * currentPrice;
        const cost = qty * avg;
        return {
            portfolioId: h.portfolioId,
            name: h.portfolioName,
            shares: qty,
            avgCost: avg,
            value,
            gain: value - cost,
        };
    });
    const totalShares = accountPositions.reduce((sum, position) => sum + position.shares, 0);
    const totalCostBasis = rows.reduce(
        (sum, holding) => sum + Number(holding.quantity) * Number(holding.avgCost),
        0,
    );

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
    };

    return (
        <>
            {header}
            <HoldingDetailView symbol={upper} holding={detail} quote={quote} />
        </>
    );
}

export default async function PortfolioDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;
    return (
        <Suspense fallback={<div className="pm-page"><p className="pm-empty-line">Loading position…</p></div>}>
            <HoldingDetailContent symbol={symbol} />
        </Suspense>
    );
}
