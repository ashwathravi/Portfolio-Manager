"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";

/**
 * Phase 3 (AR-73) Watchlist card.
 *
 * Five rows of (ticker, name, price, Δ%). Live prices from the shared
 * auto-refresh hook; static fallback from seed when quote is missing.
 *
 * The "Edit" affordance is a Link — clicking it routes to a watchlist
 * management page (stub route fine). Keeping navigation in the URL makes
 * back/forward work and keeps SSR simple.
 */

export interface WatchlistRow {
    symbol: string;
    name: string;
    /** Price used if live quote is missing. */
    fallbackPrice?: number;
    /** Δ% used if live quote is missing. */
    fallbackChangePct?: number;
}

export interface WatchlistCardProps {
    rows: WatchlistRow[];
    /** Max rows to render. Default 5 (handoff spec). */
    limit?: number;
    /** Edit button href; default /watchlist. */
    editHref?: string;
    className?: string;
}

export function WatchlistCard({
    rows,
    limit = 5,
    editHref = "/watchlist",
    className,
}: WatchlistCardProps) {
    const symbols = useMemo(
        () => rows.map((r) => r.symbol).filter(Boolean),
        [rows],
    );
    const { quotes } = useAutoRefreshQuotes(symbols);

    const shown = rows.slice(0, limit);

    return (
        <section
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            aria-label="Watchlist"
        >
            <header className="pm-card-header">
                <div>
                    <h3 className="pm-card-title">Watchlist</h3>
                    <p className="pm-card-subtitle">
                        {shown.length} {shown.length === 1 ? "ticker" : "tickers"}
                    </p>
                </div>
                <Link href={editHref} className="pm-card-link" aria-label="Edit watchlist">
                    <Pencil size={12} aria-hidden="true" style={{ verticalAlign: "-1px", marginRight: 4 }} />
                    Edit
                </Link>
            </header>

            {shown.length === 0 ? (
                <p className="pm-card-subtitle">No tickers in your watchlist yet.</p>
            ) : (
                <ul
                    style={{
                        listStyle: "none",
                        margin: 0,
                        padding: 0,
                        display: "flex",
                        flexDirection: "column",
                    }}
                >
                    {shown.map((r) => {
                        const q = quotes[r.symbol.toUpperCase()];
                        const price = Number.isFinite(q?.price) ? q!.price : r.fallbackPrice ?? null;
                        const pct = q?.changePercent ?? r.fallbackChangePct ?? 0;
                        const cls = pct < 0 ? "pm-num-neg" : "pm-num-pos";
                        return (
                            <li key={r.symbol} className="pm-watchlist-row">
                                <div className="pm-watchlist-sym">
                                    <span className="pm-watchlist-ticker">{r.symbol}</span>
                                    <span className="pm-watchlist-name" title={r.name}>
                                        {r.name}
                                    </span>
                                </div>
                                <span className="pm-watchlist-price">
                                    {price != null
                                        ? `$${price.toLocaleString("en-US", {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                          })}`
                                        : "—"}
                                </span>
                                <span className={`pm-watchlist-pct ${cls}`}>
                                    {pct >= 0 ? "+" : "−"}
                                    {Math.abs(pct).toFixed(2)}%
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
