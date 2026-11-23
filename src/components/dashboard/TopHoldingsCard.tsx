"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PriceSparkline } from "@/components/charts";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";
import { ArrowUpRight } from "lucide-react";
import { isTodaysQuote } from "@/lib/markets/quote-session";
import { useEasternDate } from "@/lib/hooks/useEasternDate";
import { topHoldings, type TopHoldingsHandValuedRow, type TopHoldingsRow } from "@/lib/today/top-holdings";

const NO_HAND_VALUED: TopHoldingsHandValuedRow[] = [];

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
 *   7. 30-day sparkline of real daily closes (a dash when unavailable)
 *
 * Live quotes from `useAutoRefreshQuotes` drive price / today %. When a
 * quote is missing for a symbol we fall back to the static seed values
 * passed in from the server.
 *
 * Holdings valued by hand are listed among them at the value given, by
 * name, tagged "Valued by hand", with no quantity unless they have units
 * and no today's move or price history (src/lib/today/top-holdings.ts).
 */

export type { TopHoldingsHandValuedRow, TopHoldingsRow } from "@/lib/today/top-holdings";

export interface TopHoldingsCardProps {
    /** Seed data from the server-side Dashboard fetch. */
    rows: TopHoldingsRow[];
    /** Holdings valued by hand, across the accounts. */
    handValued?: TopHoldingsHandValuedRow[];
    /** Max rows to render. Default 6. */
    limit?: number;
    /** Override for the "View all" link. */
    viewAllHref?: string;
    className?: string;
}

export function TopHoldingsCard({
    rows,
    handValued = NO_HAND_VALUED,
    limit = 6,
    viewAllHref = "/portfolios/holdings",
    className,
}: TopHoldingsCardProps) {
    const symbols = useMemo(
        () => rows.map((r) => r.symbol).filter(Boolean),
        [rows],
    );
    const { quotes } = useAutoRefreshQuotes(symbols);
    const todayEt = useEasternDate();

    // Sorted by value, both kinds together, sliced to the limit, each with its share of them all.
    const { lines: enriched, total } = useMemo(() => topHoldings(rows, handValued, (symbol) => {
        const q = quotes[symbol.toUpperCase()];
        if (!q) return undefined;
        // An earlier session's closing quote prices the row but isn't
        // today's move: null, shown as a dash, never "+0.00%".
        return { price: q.price, todayChangePercent: isTodaysQuote(q, todayEt) ? q.changePercent ?? null : null };
    }, limit), [rows, handValued, quotes, limit, todayEt]);

    return (
        <section
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            aria-label="Top holdings"
        >
            <header className="pm-card-header">
                <div>
                    <h3 className="pm-card-title">Top Holdings</h3>
                    <p className="pm-card-subtitle">
                        {enriched.length} of {total} positions by market value
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
                                const allocPct = r.allocationPercent;
                                const todayClass = r.todayChangePercent === null
                                    ? "pm-num-muted"
                                    : r.todayChangePercent < 0 ? "pm-num-neg" : "pm-num-pos";
                                const returnClass = r.totalReturnPercent === null
                                    ? "pm-num-muted"
                                    : r.totalReturnPercent < 0 ? "pm-num-neg" : "pm-num-pos";
                                return (
                                    <tr key={r.id} data-hand-valued={r.handValued ? "true" : undefined}>
                                        <td>
                                            {r.symbol === null ? (
                                                // No ticker: the name leads, and the tag says how it's valued.
                                                <div className="pm-holdings-ticker" data-hand-valued="true">
                                                    <span className="pm-holdings-sym">{r.name}</span>
                                                    <span className="pm-holdings-tag">Valued by hand</span>
                                                </div>
                                            ) : (
                                                <div className="pm-holdings-ticker">
                                                    <span className="pm-holdings-sym">{r.symbol}</span>
                                                    <span className="pm-holdings-name" title={r.name}>
                                                        {r.name}
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="num">{r.quantity === null ? "—" : fmtQty(r.quantity)}</td>
                                        <td className="num">{fmtCurrency(r.marketValue)}</td>
                                        <td className={`num ${todayClass}`} data-testid="top-holding-today">
                                            {r.todayChangePercent === null ? "—" : fmtSignedPct(r.todayChangePercent)}
                                        </td>
                                        <td className={`num ${returnClass}`}>
                                            {r.totalReturnPercent === null ? "—" : fmtSignedPct(r.totalReturnPercent)}
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
                                            {r.symbol === null ? (
                                                <span className="pm-spark-empty" title="No price history: valued by hand">—</span>
                                            ) : (
                                                <PriceSparkline symbol={r.symbol} />
                                            )}
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

