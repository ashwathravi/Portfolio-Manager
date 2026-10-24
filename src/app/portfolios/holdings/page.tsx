import { Suspense } from "react";
import { requirePageUserId } from "@/lib/auth/request-user";
import { isDatabaseConfigured } from "@/db/connection-options";
import { loadQuotes } from "@/lib/services/market-data-service";
import { buildUserHoldingsQuery, buildUserPortfolioOptionsQuery } from "@/lib/portfolio-repository";
import { HoldingsPageClient, type HoldingsSeed } from "@/components/holdings/HoldingsPageClient";
import { PageHeaderSync } from "@/components/layout/TopBar";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";
import { ImportHoldingsDialog, type ImportAccountOption } from "@/components/holdings/ImportHoldingsDialog";
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
    const userId = await requirePageUserId();
    let dbHoldings: Array<{
        id: string;
        symbol: string;
        name: string;
        quantity: string;
        avgCost: string;
        currentPrice: number | null;
        marketValue: number | null;
        createdAt: Date;
        portfolioName: string;
    }> = [];
    let accounts: ImportAccountOption[] = [];
    let unavailable = false;
    try {
        [dbHoldings, accounts] = await Promise.all([
            buildUserHoldingsQuery(userId),
            buildUserPortfolioOptionsQuery(userId),
        ]);
    } catch (e) {
        // With a configured database a failure is an outage, not an empty
        // portfolio; without one (local runs) the empty table is expected.
        unavailable = isDatabaseConfigured();
        if (unavailable) console.error("Holdings fetch failed — showing the outage notice.", e);
        else console.warn("Holdings fetch failed without a configured database — showing empty table.", e);
    }

    if (unavailable) {
        return (
            <>
                <PageHeaderSync
                    title="Portfolio"
                    subtitle="Every position across every account"
                    crumbs={["Portfolio", "Holdings"]}
                />
                <div className="pm-holdings-stack">
                    <DataUnavailableNotice what="your holdings" />
                </div>
            </>
        );
    }

    // Warm the quote cache so the initial paint has correct prices; without
    // market data the stored prices stand.
    const liveQuotes = await loadQuotes(dbHoldings.map((h) => h.symbol));

    // Server component: holding age is intentionally request-time derived.
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const seed: HoldingsSeed[] = dbHoldings.map((h) => {
        const qty = Number(h.quantity) || 0;
        const avg = Number(h.avgCost) || 0;
        const live = liveQuotes[h.symbol.toUpperCase()];
        // No live quote and nothing stored: no price, valued at cost.
        const stored = h.currentPrice != null && h.currentPrice > 0 ? h.currentPrice : null;
        const last = live?.price ?? stored;
        const marketValue = h.marketValue ?? qty * (last ?? avg);
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
            account: h.portfolioName,
            holdingDays,
        };
    });

    const marketValue = seed.reduce((sum, h) => sum + h.marketValue, 0);
    const subtitle = seed.length === 0
        ? "Every position across every account"
        : `${seed.length} ${seed.length === 1 ? "position" : "positions"} · $${Math.round(marketValue).toLocaleString("en-US")} market value`;

    return (
        <>
            <PageHeaderSync
                title="Portfolio"
                subtitle={subtitle}
                crumbs={["Portfolio", "Holdings"]}
                actions={seed.length > 0 ? <ImportHoldingsDialog accounts={accounts} /> : undefined}
            />
            {/* No options feed exists yet, so the LEAPS ledger runs on example
                positions and is tagged as such. */}
            <HoldingsPageClient
                holdings={seed}
                importAccounts={accounts}
                optionPositions={DEFAULT_OPTION_RISK_POSITIONS}
                optionPositionsAreSample
            />
        </>
    );
}

export default function CurrentHoldingsPage() {
    return (
        <>
            <PageHeaderSync
                title="Portfolio"
                subtitle="Every position across every account"
                crumbs={["Portfolio", "Holdings"]}
            />
            <Suspense fallback={<HoldingsLoading />}>
                <HoldingsContent />
            </Suspense>
        </>
    );
}
