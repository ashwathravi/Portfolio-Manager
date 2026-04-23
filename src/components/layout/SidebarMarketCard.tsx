"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatEtClock, isMarketOpen } from "@/lib/markets/market-hours";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";

/**
 * Sidebar Market Card (AR-66)
 *
 * Shows:
 *   - a live green dot with a ping pulse when NYSE is in regular session,
 *     a muted dot when it's closed
 *   - the current Eastern-time clock (ticks every 30s)
 *   - three index rows (S&P 500, Nasdaq 100, BTC) with signed percent delta
 *
 * Indices use the shared `useAutoRefreshQuotes` hook so they stay in sync
 * with the user's configured `marketDataRefreshSeconds` preference and
 * benefit from TanStack Query's dedup + tab-hidden pause.
 *
 * Symbols:
 *   SPY  → S&P 500 ETF proxy (every provider supports it)
 *   QQQ  → Nasdaq 100 ETF proxy
 *   BTC-USD → Bitcoin. Some provider tiers don't return a crypto quote;
 *             we show `—` in that case rather than failing the whole card.
 */

interface IndexRow {
    label: string;
    symbol: string;
}

const INDICES: readonly IndexRow[] = [
    { label: "S&P", symbol: "SPY" },
    { label: "NDX", symbol: "QQQ" },
    { label: "BTC", symbol: "BTC-USD" },
] as const;

const INDEX_SYMBOLS = INDICES.map((i) => i.symbol);

/** Tick the ET clock every 30s. The `isMarketOpen` check re-runs on the
 *  same cadence, which is enough to flip the dot at 9:30 / 16:00 without
 *  a burdensome setInterval(…, 1000). */
const CLOCK_TICK_MS = 30_000;

function useEtClock() {
    const [now, setNow] = useState<Date | null>(null);
    // Tick `now` off of a client-only interval. We intentionally seed with
    // `null` on the first render so SSR and the first client paint produce
    // identical output — otherwise the "9:42 AM ET" text would mismatch.
    useEffect(() => {
        setNow(new Date());
        const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
        return () => clearInterval(id);
    }, []);
    return now;
}

function formatDelta(pct: number | null | undefined): string {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
    const sign = pct > 0 ? "+" : "";
    return `${sign}${pct.toFixed(2)}%`;
}

function deltaClass(pct: number | null | undefined): string {
    if (pct === null || pct === undefined || !Number.isFinite(pct))
        return "pm-market-delta";
    if (pct > 0) return "pm-market-delta pos";
    if (pct < 0) return "pm-market-delta neg";
    return "pm-market-delta";
}

export function SidebarMarketCard() {
    const now = useEtClock();
    const open = now ? isMarketOpen(now) : false;
    const clock = now ? formatEtClock(now) : "—";

    const { quotes } = useAutoRefreshQuotes(INDEX_SYMBOLS);

    // Derive a flat {symbol → percentChange} map so the row render stays
    // dumb. `MarketQuote.changePercent` is stored in *percent* units
    // (1.35 → 1.35%, matching `alpha-vantage.test.ts` and the existing
    // alert engine's `/ 100` conversion), so we pass it through unchanged.
    const deltas = useMemo(() => {
        const out: Record<string, number | null> = {};
        for (const row of INDICES) {
            const q = quotes[row.symbol];
            out[row.symbol] =
                q && typeof q.changePercent === "number" ? q.changePercent : null;
        }
        return out;
    }, [quotes]);

    return (
        <section className="pm-market-card" aria-label="Market status">
            <div className="pm-market-header">
                <span
                    aria-hidden="true"
                    className={cn("pm-live-dot", !open && "is-closed")}
                />
                <span className="pm-market-status">
                    {open ? "Market open" : "Market closed"}
                </span>
                <span
                    className="pm-market-clock"
                    aria-label={`Current time in Eastern: ${clock}`}
                >
                    {clock}
                </span>
            </div>
            <ul className="pm-market-indices">
                {INDICES.map((row) => {
                    const pct = deltas[row.symbol];
                    return (
                        <li key={row.symbol} className="pm-market-row">
                            <span className="pm-market-label">{row.label}</span>
                            <span
                                className={deltaClass(pct)}
                                aria-label={`${row.label} ${formatDelta(pct)}`}
                            >
                                {formatDelta(pct)}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
