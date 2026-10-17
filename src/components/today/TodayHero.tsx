"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";
import { LiveDataIndicator } from "@/components/data-display/LiveDataIndicator";
import { formatPct, formatUsd } from "@/lib/format";
import { isTodaysQuote } from "@/lib/markets/quote-session";
import { useEasternDate } from "@/lib/hooks/useEasternDate";

export interface TodayHeroHolding {
    symbol: string;
    quantity: number;
    currentPrice: number;
    marketValue: number;
}

/**
 * Today's hero: the money. Net worth and today's change from the user's
 * own holdings (live quotes when available), with invested / cash /
 * positions beneath. No illustrative sparklines or hardcoded deltas —
 * the old stat row showed "+1.2% vs last month" regardless of data.
 */
export function TodayHero({ holdings, cashTotal }: { holdings: TodayHeroHolding[]; cashTotal: number }) {
    const symbols = useMemo(() => holdings.map((h) => h.symbol).filter(Boolean), [holdings]);
    const { quotes, isFetching, isError, refreshMs, refetch, lastUpdatedAt } = useAutoRefreshQuotes(symbols);

    const todayEt = useEasternDate();
    const { invested, change, live, today } = useMemo(() => {
        let value = 0;
        let delta = 0;
        let hasLive = false;
        let hasToday = false;
        for (const h of holdings) {
            const q = quotes[h.symbol.toUpperCase()];
            if (q && Number.isFinite(q.price)) {
                value += h.quantity * q.price;
                hasLive = true;
                // Before today's close the newest price is the last session's;
                // its change belongs to that day, not today.
                if (isTodaysQuote(q, todayEt)) {
                    delta += (q.change ?? 0) * h.quantity;
                    hasToday = true;
                }
            } else {
                value += h.marketValue || h.quantity * h.currentPrice;
            }
        }
        return { invested: value, change: delta, live: hasLive, today: hasToday };
    }, [holdings, quotes, todayEt]);

    const netWorth = invested + cashTotal;
    const liveIndicator = (
        <div className="pm-today-hero-live">
            <LiveDataIndicator
                isFetching={isFetching}
                isError={isError && !live}
                refreshMs={refreshMs}
                lastUpdatedAt={lastUpdatedAt}
                onRefresh={() => void refetch()}
            />
        </div>
    );
    const changePct = netWorth - change > 0 ? (change / (netWorth - change)) * 100 : 0;

    if (holdings.length === 0 && cashTotal === 0) {
        return (
            <section className="pm-card pm-empty-card pm-today-hero" data-testid="today-hero" data-empty="true">
                <div className="pm-today-hero-emptyhead">
                    <span className="pm-today-label">Net worth</span>
                    {liveIndicator}
                </div>
                <h2>Connect an account to see your net worth</h2>
                <p>Today shows your money first — net worth and today&apos;s change — then anything that needs your attention.</p>
                <div className="pm-empty-actions">
                    <Link href="/settings#accounts" className="pm-btn pm-btn-primary">Connect an account</Link>
                </div>
            </section>
        );
    }

    return (
        <section className="pm-card pm-today-hero" data-testid="today-hero" aria-label="Net worth">
            <div className="pm-today-hero-main">
                <span className="pm-today-label">Net worth</span>
                <p className="pm-today-networth" data-testid="today-networth">{formatUsd(netWorth)}</p>
                <p className={`pm-today-change ${today ? (change > 0 ? "pm-pos" : change < 0 ? "pm-neg" : "") : ""}`}>
                    {today ? (
                        <>
                            {formatUsd(change, { signed: true })} ({formatPct(changePct, { signed: true, decimals: 2 })}) today
                        </>
                    ) : live ? (
                        "Prices as of the last close"
                    ) : (
                        "Today's change appears when live quotes arrive"
                    )}
                </p>
            </div>
            <dl className="pm-today-hero-facts">
                <div><dt>Invested</dt><dd>{formatUsd(invested, { decimals: 0 })}</dd></div>
                <div><dt>Cash</dt><dd>{formatUsd(cashTotal, { decimals: 0 })}</dd></div>
                <div><dt>Positions</dt><dd>{holdings.length}</dd></div>
            </dl>
            {liveIndicator}
        </section>
    );
}
