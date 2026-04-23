"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Sparkline } from "@/components/charts";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";
import { ArrowUpRight } from "lucide-react";

/**
 * Phase 3 (AR-72) Top-holdings table card.
 *
 * Seven columns (left → right):
 *   1. Ticker + name stack
 *   2. Quantity (mono, right-aligned)
 *   3. Market value (mono, right-aligned)
 *   4. Today %  (green/red)
 *   5. Total return %  (green/red)
 *   6. Allocation bar + %
 *   7. 30-day sparkline — red when today's change is negative
 *
 * Live quotes from `useAutoRefreshQuotes` drive price / today %. When a
 * quote is missing for a symbol we fall back to the static seed values
 * passed in from the server.
 */

export interface TopHoldingsRow {
    id: string;
    symbol: string;
    name: string;
    quantity: number;
    avgCost: number;
    currentPrice: number;
    marketValue: number;
    /** Optional 30-day trailing series. When absent, we synthesize one. */
    spark30d?: number[];
}

export interface TopHoldingsCardProps {
    /** Seed data from the server-side Dashboard fetch. */
    rows: TopHoldingsRow[];
    /** Max rows to render. Default 6. */
    limit?: number;
    /** Override for the "View all" link. */
    viewAllHref?: string;
    className?: string;
}

export function TopHoldingsCard({
    rows,
    limit = 6,
    viewAllHref = "/portfolios/holdings",
    className,
}: TopHoldingsCardProps) {
    const symbols = useMemo(
        () => rows.map((r) => r.symbol).filter(Boolean),
        [rows],
    );
    const { quotes } = useAutoRefreshQuotes(symbols);

    // Sort by MV desc; slice to limit. Compute totals for the allocation bar.
    const { enriched, totalMV } = useMemo(() => {
        const withQuote = rows.map((r) => {
            const q = quotes[r.symbol.toUpperCase()];
            const price = Number.isFinite(q?.price) ? q!.price : r.currentPrice;
            const marketValue = r.quantity * price;
            const todayChangePercent = q ? q.changePercent : 0;
            const totalReturnPercent =
                r.avgCost > 0 ? ((price - r.avgCost) / r.avgCost) * 100 : 0;
            return {
                ...r,
                price,
                marketValue,
                todayChangePercent,
                totalReturnPercent,
            };
        });

        const total = withQuote.reduce((sum, r) => sum + r.marketValue, 0);
        const sorted = [...withQuote]
            .sort((a, b) => b.marketValue - a.marketValue)
            .slice(0, limit);
        return { enriched: sorted, totalMV: total };
    }, [rows, quotes, limit]);

    return (
        <section
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            aria-label="Top holdings"
        >
            <header className="pm-card-header">
                <div>
                    <h3 className="pm-card-title">Top Holdings</h3>
                    <p className="pm-card-subtitle">
                        {enriched.length} of {rows.length} positions by market value
                    </p>
                </div>
                <Link href={viewAllHref} className="pm-card-link">
                    View all <ArrowUpRight size={12} aria-hidden="true" style={{ verticalAlign: "-1px" }} />
                </Link>
            </header>

            <div style={{ overflowX: "auto" }}>
                <table className="pm-holdings-table">
                    <thead>
                        <tr>
                            <th>Ticker</th>
                            <th className="num">Qty</th>
                            <th className="num">Market Value</th>
                            <th className="num">Today</th>
                            <th className="num">Total Return</th>
                            <th>Alloc</th>
                            <th>30d</th>
                        </tr>
                    </thead>
                    <tbody>
                        {enriched.length === 0 ? (
                            <tr>
                                <td colSpan={7} style={{ textAlign: "center", color: "var(--pm-fg-subtle)" }}>
                                    No holdings yet.
                                </td>
                            </tr>
                        ) : (
                            enriched.map((r) => {
                                const allocPct =
                                    totalMV > 0 ? (r.marketValue / totalMV) * 100 : 0;
                                const spark = r.spark30d ?? synthesizeSpark(r.price, r.symbol);
                                const todayNeg = r.todayChangePercent < 0;
                                return (
                                    <tr key={r.id}>
                                        <td>
                                            <div className="pm-holdings-ticker">
                                                <span className="pm-holdings-sym">{r.symbol}</span>
                                                <span className="pm-holdings-name" title={r.name}>
                                                    {r.name}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="num">{fmtQty(r.quantity)}</td>
                                        <td className="num">{fmtCurrency(r.marketValue)}</td>
                                        <td className={`num ${todayNeg ? "pm-num-neg" : "pm-num-pos"}`}>
                                            {fmtSignedPct(r.todayChangePercent)}
                                        </td>
                                        <td className={`num ${r.totalReturnPercent < 0 ? "pm-num-neg" : "pm-num-pos"}`}>
                                            {fmtSignedPct(r.totalReturnPercent)}
                                        </td>
                                        <td className="pm-alloc-bar-cell">
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 6,
                                                }}
                                            >
                                                <div className="pm-alloc-bar">
                                                    <div
                                                        className="pm-alloc-bar-fill"
                                                        style={{ width: `${Math.min(100, allocPct).toFixed(1)}%` }}
                                                    />
                                                </div>
                                                <span className="num" style={{ minWidth: 40, textAlign: "right" }}>
                                                    {allocPct.toFixed(1)}%
                                                </span>
                                            </div>
                                        </td>
                                        <td>
                                            <Sparkline
                                                data={spark}
                                                width={72}
                                                height={22}
                                                color={todayNeg ? "var(--pm-danger)" : "var(--pm-success)"}
                                                strokeWidth={1.25}
                                                ariaLabel={`${r.symbol} 30-day trend`}
                                            />
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtQty(q: number): string {
    if (q >= 1000) return q.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (Number.isInteger(q)) return String(q);
    return q.toFixed(2);
}

function fmtCurrency(n: number): string {
    return `$${n.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
}

function fmtSignedPct(n: number): string {
    const sign = n >= 0 ? "+" : "−";
    return `${sign}${Math.abs(n).toFixed(2)}%`;
}

/**
 * Deterministic 30-point walk keyed to ticker so each row gets a distinct
 * sparkline even when all prices are the same (e.g. right after seed).
 */
function synthesizeSpark(price: number, seedKey: string): number[] {
    let seed = 0;
    for (let i = 0; i < seedKey.length; i++) {
        seed = (seed * 31 + seedKey.charCodeAt(i)) | 0;
    }
    const rand = mulberry32(seed || 1);
    const base = Math.abs(price) || 1;
    const out: number[] = new Array(30);
    let x = base;
    for (let i = 0; i < 30; i++) {
        x += (rand() - 0.5) * 0.04 * base;
        out[i] = x;
    }
    out[29] = price;
    return out;
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
