import { Suspense } from "react";
import { db } from "@/db";
import { marketDataEngine } from "@/lib/api/market-data";
import { HoldingsPageClient, type HoldingsSeed } from "@/components/holdings/HoldingsPageClient";
import { PageHeaderSync } from "@/components/layout/TopBar";
import HoldingsLoading from "./loading";
import { DEFAULT_OPTION_RISK_POSITIONS } from "@/lib/risk-policy";

/**
 * Phase 4 (AR-74) Holdings page.
 *
 * The server half fetches portfolio + holding rows and warms the quote cache
 * so the initial paint has correct prices. Everything interactive
 * (filter chips, sort select, live polling) is in the client child.
 */

export const dynamic = "force-dynamic";

async function HoldingsContent() {
    let dbHoldings: Array<{
        id: string;
        symbol: string;
        name: string;
        quantity: string;
        avgCost: string;
        currentPrice: number | null;
        marketValue: number | null;
        createdAt: Date;
        portfolio?: { name: string } | null;
    }> = [];
    try {
        dbHoldings = await db.query.holdings.findMany({
            with: { portfolio: true },
        });
    } catch (e) {
        console.warn("Holdings fetch failed — showing empty table.", e);
    }

    // Warm the quote cache so the initial paint has correct prices.
    let liveQuotes: Record<string, { price: number; change: number; changePercent: number }> = {};
    try {
        const symbols = Array.from(
            new Set(dbHoldings.map((h) => h.symbol).filter(Boolean)),
        );
        if (symbols.length > 0) {
            liveQuotes = await marketDataEngine.getQuotes(symbols);
        }
    } catch (e) {
        console.warn("Failed to warm quote cache for holdings page", e);
    }

    // Server component: holding age is intentionally request-time derived.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const seed: HoldingsSeed[] = dbHoldings.map((h) => {
        const qty = Number(h.quantity) || 0;
        const avg = Number(h.avgCost) || 0;
        const live = liveQuotes[h.symbol.toUpperCase()];
        const last = live?.price ?? Number(h.currentPrice ?? 0) ?? 0;
        const marketValue = h.marketValue ?? qty * last;
        const holdingDays = Math.max(
            0,
            Math.round((now - new Date(h.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
        );
        return {
            id: h.id,
            symbol: h.symbol,
            name: h.name,
            quantity: qty,
            avgCost: avg,
            currentPrice: last,
            marketValue,
            account: h.portfolio?.name ?? "Unknown Portfolio",
            holdingDays,
        };
    });

    return <HoldingsPageClient holdings={seed} optionPositions={DEFAULT_OPTION_RISK_POSITIONS} />;
}

export default function CurrentHoldingsPage() {
    return (
        <>
            <PageHeaderSync
                title="Holdings"
                subtitle="Every position across every account"
                crumbs={["Workspace", "Holdings"]}
            />
            <Suspense fallback={<HoldingsLoading />}>
                <HoldingsContent />
            </Suspense>
        </>
    );
}
