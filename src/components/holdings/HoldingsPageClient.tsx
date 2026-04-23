"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Plus, Upload } from "lucide-react";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";
import { sectorFor, type Sector } from "@/lib/holdings/sector";
import {
    HoldingsFilterRow,
    type HoldingsSortKey,
} from "./HoldingsFilterRow";
import { HoldingsFullTable, type HoldingsTableRow } from "./HoldingsFullTable";
import { HoldingsSummaryStrip } from "./HoldingsSummaryStrip";

/**
 * Phase 4 (AR-74) Holdings page wrapper.
 *
 * This component owns:
 *   - live-quote polling via `useAutoRefreshQuotes`
 *   - the filter + sort state
 *   - the derived summary metrics
 *
 * The server page just fetches the seed + hands it here. Everything
 * downstream (summary strip, filter row, table) is stateless.
 */

export interface HoldingsSeed {
    id: string;
    symbol: string;
    name: string;
    quantity: number;
    avgCost: number;
    currentPrice: number;
    marketValue: number;
    account: string;
    /** Approx days since the position was opened, for the "Avg holding period" cell. */
    holdingDays?: number;
    /** Optional sector override — if omitted we fall back to `sectorFor(symbol)`. */
    sector?: Sector;
}

export interface HoldingsPageClientProps {
    holdings: HoldingsSeed[];
}

export function HoldingsPageClient({ holdings }: HoldingsPageClientProps) {
    const [sectorFilter, setSectorFilter] = useState<Sector | "All">("All");
    const [sortKey, setSortKey] = useState<HoldingsSortKey>("marketValue");

    const symbols = useMemo(
        () => holdings.map((h) => h.symbol).filter(Boolean),
        [holdings],
    );
    const { quotes } = useAutoRefreshQuotes(symbols);

    // ---- Enrich with live quote, then derive allocation + today% ----
    const enriched = useMemo(() => {
        const withQuote = holdings.map((h) => {
            const q = quotes[h.symbol.toUpperCase()];
            const last = Number.isFinite(q?.price) ? q!.price : h.currentPrice;
            const marketValue = h.quantity * last;
            const costBasis = h.quantity * h.avgCost;
            const totalReturnPct =
                h.avgCost > 0 ? ((last - h.avgCost) / h.avgCost) * 100 : 0;
            const todayPct = q ? q.changePercent : 0;
            const todayChangeAbs =
                q?.change != null ? q.change * h.quantity : 0;
            const sector = h.sector ?? sectorFor(h.symbol);
            return {
                ...h,
                sector,
                last,
                marketValue,
                costBasis,
                totalReturnPct,
                todayPct,
                todayChangeAbs,
            };
        });

        const totalMV = withQuote.reduce((s, r) => s + r.marketValue, 0);
        const enrichedRows = withQuote.map((r) => ({
            ...r,
            allocationPct: totalMV > 0 ? (r.marketValue / totalMV) * 100 : 0,
        }));
        return { rows: enrichedRows, totalMV };
    }, [holdings, quotes]);

    const { rows, totalMV } = enriched;

    // ---- Summary metrics (always over the full set, not the filtered view) ----
    const summary = useMemo(() => {
        const totalCostBasis = rows.reduce((s, r) => s + r.costBasis, 0);
        const unrealized = totalMV - totalCostBasis;
        const unrealizedPct =
            totalCostBasis > 0 ? (unrealized / totalCostBasis) * 100 : 0;
        const today = rows.reduce((s, r) => s + r.todayChangeAbs, 0);
        const positions = rows.length;

        const avgHoldingDays = (() => {
            const withDays = rows.filter((r) => Number.isFinite(r.holdingDays ?? NaN));
            if (withDays.length === 0) return 0;
            const sum = withDays.reduce((s, r) => s + (r.holdingDays ?? 0), 0);
            return sum / withDays.length;
        })();

        // Concentration = share of total MV in the 3 largest positions.
        const sortedByMV = [...rows].sort((a, b) => b.marketValue - a.marketValue);
        const top3 = sortedByMV.slice(0, 3).reduce((s, r) => s + r.marketValue, 0);
        const concentrationTop3 = totalMV > 0 ? top3 / totalMV : 0;

        return {
            marketValue: totalMV,
            unrealized,
            unrealizedPct,
            today,
            positions,
            avgHoldingDays,
            concentrationTop3,
        };
    }, [rows, totalMV]);

    // ---- Filter + sort for the table ----
    const tableRows = useMemo<HoldingsTableRow[]>(() => {
        const filtered =
            sectorFilter === "All"
                ? rows
                : rows.filter((r) => r.sector === sectorFilter);
        const sorted = [...filtered].sort((a, b) => {
            switch (sortKey) {
                case "marketValue":
                    return b.marketValue - a.marketValue;
                case "totalReturnPct":
                    return b.totalReturnPct - a.totalReturnPct;
                case "todayPct":
                    return b.todayPct - a.todayPct;
                case "allocationPct":
                    return b.allocationPct - a.allocationPct;
            }
        });
        return sorted.map((r) => ({
            id: r.id,
            symbol: r.symbol,
            name: r.name,
            sector: r.sector,
            quantity: r.quantity,
            avgCost: r.avgCost,
            last: r.last,
            marketValue: r.marketValue,
            todayPct: r.todayPct,
            totalReturnPct: r.totalReturnPct,
            allocationPct: r.allocationPct,
            account: r.account,
        }));
    }, [rows, sectorFilter, sortKey]);

    return (
        <div className="pm-holdings-stack">
            <header className="pm-holdings-topbar">
                <div>
                    <nav className="pm-crumbs" aria-label="Breadcrumb">
                        <Link href="/portfolios">Portfolio</Link>
                        <span className="pm-crumbs-sep">/</span>
                        <span aria-current="page">Holdings</span>
                    </nav>
                    <h1 className="pm-page-title">Current holdings</h1>
                    <p className="pm-page-sub">
                        {summary.positions} {summary.positions === 1 ? "position" : "positions"}
                        {" · "}${summary.marketValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} equity
                    </p>
                </div>
                <div className="pm-topbar-actions">
                    <Link href="/portfolios/trade-log" className="pm-btn pm-btn-ghost">
                        <Upload size={14} aria-hidden="true" />
                        <span>Import CSV</span>
                    </Link>
                    <Link href="/portfolios" className="pm-btn pm-btn-primary">
                        <Plus size={14} aria-hidden="true" />
                        <span>Add position</span>
                    </Link>
                </div>
            </header>

            <HoldingsSummaryStrip
                marketValue={summary.marketValue}
                unrealizedGain={summary.unrealized}
                unrealizedGainPct={summary.unrealizedPct}
                todayPnL={summary.today}
                positions={summary.positions}
                avgHoldingDays={summary.avgHoldingDays}
                concentrationTop3={summary.concentrationTop3}
            />

            <HoldingsFilterRow
                sectorFilter={sectorFilter}
                onSectorChange={setSectorFilter}
                sortKey={sortKey}
                onSortChange={setSortKey}
            />

            <HoldingsFullTable rows={tableRows} />

            {rows.length === 0 && (
                <div className="pm-card pm-card-stack" style={{ textAlign: "center" }}>
                    <h3 className="pm-card-title">No holdings yet</h3>
                    <p className="pm-card-subtitle">
                        Positions will appear here once you add them to a portfolio.{" "}
                        <Link href="/portfolios" className="pm-card-link">
                            Go to portfolios <ArrowUpRight size={12} aria-hidden="true" />
                        </Link>
                    </p>
                </div>
            )}
        </div>
    );
}
