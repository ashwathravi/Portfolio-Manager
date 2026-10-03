"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";
import { useWatchlist } from "@/lib/research/useWatchlist";
import { SampleTag } from "@/components/data-display/SampleTag";

/**
 * Today › Watchlist. Reads the same saved watchlist as Research, with live
 * quotes. There are no fallback prices: a stored price goes stale and reads
 * as real, so a missing quote shows a dash. Example rows carry a Sample tag
 * until the user edits or replaces them.
 */

export interface WatchlistCardProps {
    /** Max rows to render. Default 5. */
    limit?: number;
    className?: string;
}

export function WatchlistCard({ limit = 5, className }: WatchlistCardProps) {
    const { items } = useWatchlist();
    const shown = items.slice(0, limit);
    const symbols = useMemo(() => shown.map((r) => r.ticker), [shown]);
    const { quotes } = useAutoRefreshQuotes(symbols);
    const hasSample = shown.some((r) => r.sample);

    return (
        <section
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            aria-label="Watchlist"
            data-testid="today-watchlist"
        >
            <header className="pm-card-header">
                <div>
                    <h3 className="pm-card-title">
                        Watchlist {hasSample && <SampleTag />}
                    </h3>
                    <p className="pm-card-subtitle">
                        {items.length} {items.length === 1 ? "ticker" : "tickers"}
                    </p>
                </div>
                <Link href="/research?tab=watchlist" className="pm-card-link">
                    <Pencil size={12} aria-hidden="true" style={{ verticalAlign: "-1px", marginRight: 4 }} />
                    Manage
                </Link>
            </header>

            {shown.length === 0 ? (
                <p className="pm-card-subtitle">
                    Nothing on your watchlist. Add tickers from Research or any position page.
                </p>
            ) : (
                <ul className="pm-watchlist-list">
                    {shown.map((r) => {
                        const q = quotes[r.ticker];
                        const price = q && Number.isFinite(q.price) && q.price > 0 ? q.price : null;
                        const pct = q && Number.isFinite(q.changePercent) ? q.changePercent : null;
                        return (
                            <li key={r.id} className="pm-watchlist-row">
                                <Link href={`/portfolios/detail/${r.ticker}`} className="pm-watchlist-sym">
                                    <span className="pm-watchlist-ticker">{r.ticker}</span>
                                    <span className="pm-watchlist-name" title={r.companyName}>
                                        {r.companyName}
                                    </span>
                                </Link>
                                <span className="pm-watchlist-price">
                                    {price != null
                                        ? `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                        : "—"}
                                </span>
                                <span className={`pm-watchlist-pct ${pct == null ? "" : pct < 0 ? "pm-num-neg" : "pm-num-pos"}`}>
                                    {pct == null ? "—" : `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
