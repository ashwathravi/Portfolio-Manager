"use client";

import { useMemo } from "react";
import {
    Wallet,
    TrendingUp,
    Gauge,
    Droplets,
} from "lucide-react";
import { StatCard } from "./StatCard";
import { LiveDataIndicator } from "@/components/data-display/LiveDataIndicator";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";

/**
 * Phase 3 (AR-71) 4-card stat row.
 *
 * Four headline metrics:
 *   1. Net Worth         — cash + live holdings value.
 *   2. Today's P&L       — $ + % change today across holdings.
 *   3. Alpha vs S&P      — portfolio return minus S&P TTM (caller supplies).
 *   4. Cash Runway       — months of runway = cash / monthly burn.
 *
 * The row is the same `useAutoRefreshQuotes` live-data path as the legacy
 * `DashboardLiveStats`, so quotes polling rate + TanStack Query caching
 * stays shared across all live UI.
 */

export interface DashboardStatRowHolding {
    symbol: string;
    quantity: number;
    currentPrice: number;
    marketValue: number;
}

export interface DashboardStatRowProps {
    /** Combined cash balance across all portfolios. */
    cashTotal: number;
    /** Holdings seed for quote refresh + Net-Worth math. */
    holdings: DashboardStatRowHolding[];
    /** Server-side fallback for Today's P&L before the client poll lands. */
    fallbackTodayChange: number;
    /**
     * Portfolio TTM return minus S&P TTM, in percentage points. Optional —
     * when absent, the Alpha card renders a neutral "—".
     */
    alphaVsSp?: number;
    /**
     * Monthly burn used for the runway calculation. Defaults to $5,000/mo
     * until we wire a real value. A sensible default keeps the card useful
     * on a fresh install.
     */
    monthlyBurn?: number;
}

const DEFAULT_MONTHLY_BURN = 5_000;

export function DashboardStatRow({
    cashTotal,
    holdings,
    fallbackTodayChange,
    alphaVsSp,
    monthlyBurn = DEFAULT_MONTHLY_BURN,
}: DashboardStatRowProps) {
    const symbols = useMemo(
        () => holdings.map((h) => h.symbol).filter(Boolean),
        [holdings],
    );

    const { quotes, isFetching, isError, refreshMs, refetch, lastUpdatedAt } =
        useAutoRefreshQuotes(symbols);

    const { totalNetWorth, todayChange, hasLiveData } = useMemo(() => {
        let netHoldings = 0;
        let change = 0;
        let live = false;

        for (const h of holdings) {
            const quote = quotes[h.symbol.toUpperCase()];
            if (quote && Number.isFinite(quote.price)) {
                netHoldings += h.quantity * quote.price;
                change += (quote.change ?? 0) * h.quantity;
                live = true;
            } else {
                netHoldings += h.marketValue || h.quantity * h.currentPrice;
            }
        }

        return {
            totalNetWorth: cashTotal + netHoldings,
            todayChange: live ? change : fallbackTodayChange,
            hasLiveData: live,
        };
    }, [holdings, quotes, cashTotal, fallbackTodayChange]);

    const todayChangePercent =
        totalNetWorth > 0
            ? (todayChange / Math.max(totalNetWorth - todayChange, 1)) * 100
            : 0;

    const runwayMonths =
        monthlyBurn > 0 ? cashTotal / monthlyBurn : Number.POSITIVE_INFINITY;

    // Seeds for the top-right sparkline on each card. These are illustrative
    // until we wire historical series — each one is a deterministic walk
    // anchored at the current value so the line feels tied to the headline.
    const sparkNet = useMemo(
        () => walk(totalNetWorth, 12, 0.004, "netWorth"),
        [totalNetWorth],
    );
    const sparkPnl = useMemo(
        () => walk(Math.abs(todayChange), 12, 0.025, "pnl", todayChange < 0),
        [todayChange],
    );
    const sparkAlpha = useMemo(
        () => walk(alphaVsSp ?? 1.2, 12, 0.03, "alpha", (alphaVsSp ?? 0) < 0),
        [alphaVsSp],
    );
    const sparkRunway = useMemo(
        () =>
            walk(
                Number.isFinite(runwayMonths) ? runwayMonths : 12,
                12,
                0.02,
                "runway",
            ),
        [runwayMonths],
    );

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-end">
                <LiveDataIndicator
                    isFetching={isFetching}
                    isError={isError && !hasLiveData}
                    refreshMs={refreshMs}
                    lastUpdatedAt={lastUpdatedAt}
                    onRefresh={() => void refetch()}
                />
            </div>
            <div className="pm-grid-stats" aria-label="Dashboard key stats">
                <StatCard
                    label="Net Worth"
                    value={fmtCurrency(totalNetWorth)}
                    delta="+1.2%"
                    sub="vs last month"
                    icon={<Wallet size={14} aria-hidden="true" />}
                    sparkSeed={sparkNet}
                />
                <StatCard
                    label="Today's P&L"
                    value={`${todayChange >= 0 ? "+" : "−"}${fmtCurrency(Math.abs(todayChange))}`}
                    delta={`${todayChange >= 0 ? "+" : "−"}${todayChangePercent.toFixed(2)}%`}
                    sub={hasLiveData ? "Live quotes" : "Awaiting live quotes"}
                    positive={todayChange >= 0}
                    icon={<TrendingUp size={14} aria-hidden="true" />}
                    sparkSeed={sparkPnl}
                />
                <StatCard
                    label="Alpha vs S&P"
                    value={alphaVsSp != null ? `${alphaVsSp >= 0 ? "+" : "−"}${Math.abs(alphaVsSp).toFixed(2)} pp` : "—"}
                    delta={alphaVsSp != null ? (alphaVsSp >= 0 ? "Outperforming" : "Trailing") : undefined}
                    sub="Trailing 12 months"
                    positive={alphaVsSp != null ? alphaVsSp >= 0 : undefined}
                    icon={<Gauge size={14} aria-hidden="true" />}
                    sparkSeed={sparkAlpha}
                />
                <StatCard
                    label="Cash Runway"
                    value={
                        Number.isFinite(runwayMonths)
                            ? `${runwayMonths.toFixed(1)} mo`
                            : "∞"
                    }
                    delta={Number.isFinite(runwayMonths) && runwayMonths < 6 ? "Low" : undefined}
                    sub={`At $${monthlyBurn.toLocaleString("en-US")}/mo burn`}
                    positive={
                        Number.isFinite(runwayMonths) ? runwayMonths >= 6 : true
                    }
                    icon={<Droplets size={14} aria-hidden="true" />}
                    sparkSeed={sparkRunway}
                />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(n: number): string {
    return `$${n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

/**
 * Deterministic pseudo-random walk ending at `endValue`. We use this only
 * for the miniature sparkline on each card — real historical series will
 * replace it once the aggregator wires them up.
 *
 *   - `amplitude`: max step as a fraction of endValue.
 *   - `seedKey`: name keyed into the hash so different cards draw
 *                different walks even at the same endValue.
 *   - `invert`: flip the walk so negative-P&L cards trend downward.
 */
function walk(
    endValue: number,
    points: number,
    amplitude: number,
    seedKey: string,
    invert = false,
): number[] {
    const series: number[] = new Array(points);
    const base = Math.abs(endValue) || 1;
    let x = base;
    // Hash seed → small integer for a stable mulberry32 state.
    let seed = 0;
    for (let i = 0; i < seedKey.length; i++) {
        seed = (seed * 31 + seedKey.charCodeAt(i)) | 0;
    }
    const rand = mulberry32(seed || 1);
    for (let i = 0; i < points; i++) {
        const delta = (rand() - 0.5) * 2 * amplitude * base;
        x = x + delta;
        series[i] = x;
    }
    // Anchor the last point to the real endValue for visual continuity.
    series[points - 1] = endValue;
    return invert ? series.map((v) => -v + 2 * endValue) : series;
}

function mulberry32(a: number): () => number {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
