"use client";

import { useMemo } from "react";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";
import { LiveDataIndicator } from "@/components/data-display/LiveDataIndicator";
import { formatPct, formatUsd } from "@/lib/format";
import { isTodaysQuote } from "@/lib/markets/quote-session";
import { useEasternDate } from "@/lib/hooks/useEasternDate";
import type { ImportAccountOption } from "@/components/holdings/ImportHoldingsDialog";
import { FirstRunCard } from "./FirstRunCard";

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
 * Without any positions it is the first-run card (FirstRunCard): the
 * steps to an account with positions in it.
 */
export function TodayHero({
    holdings,
    cashTotal,
    accounts,
}: {
    holdings: TodayHeroHolding[];
    cashTotal: number;
    /** The user's accounts, for the first-run steps and the CSV import. */
    accounts: readonly ImportAccountOption[];
}) {
    const symbols = useMemo(() => holdings.map((h) => h.symbol).filter(Boolean), [holdings]);
    const { quotes, isFetching, isError, refreshMs, refetch, lastUpdatedAt } = useAutoRefreshQuotes(symbols);

    const todayEt = useEasternDate();
    const { invested, change, live, positions, movedToday } = useMemo(() => {
        let value = 0;
        let delta = 0;
        let hasLive = false;
        let held = 0;
        let moved = 0;
        for (const h of holdings) {
            const q = quotes[h.symbol.toUpperCase()];
            if (h.quantity !== 0) held++;
            if (q && Number.isFinite(q.price)) {
                value += h.quantity * q.price;
                hasLive = true;
                // Before today's close the newest price is the last session's;
                // its change belongs to that day, not today.
                if (isTodaysQuote(q, todayEt)) {
                    delta += q.change * h.quantity;
                    if (h.quantity !== 0) moved++;
                }
            } else {
                value += h.marketValue || h.quantity * h.currentPrice;
            }
        }
        return { invested: value, change: delta, live: hasLive, positions: held, movedToday: moved };
    }, [holdings, quotes, todayEt]);
    // The headline is the portfolio's move only when every position has one
    // from today's session; otherwise it is labelled as covering some of them.
    const today = movedToday > 0;
    const complete = today && movedToday === positions;

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

    if (holdings.length === 0) return <FirstRunCard accounts={accounts} cashTotal={cashTotal} />;

    return (
        <section className="pm-card pm-today-hero" data-testid="today-hero" aria-label="Net worth">
            <div className="pm-today-hero-main">
                <span className="pm-today-label">Net worth</span>
                <p className="pm-today-networth" data-testid="today-networth">{formatUsd(netWorth)}</p>
                <p
                    className={`pm-today-change ${today ? (change > 0 ? "pm-pos" : change < 0 ? "pm-neg" : "") : ""}`}
                    data-testid="today-change"
                >
                    {complete ? (
                        <>
                            {formatUsd(change, { signed: true })} ({formatPct(changePct, { signed: true, decimals: 2 })}) today
                        </>
                    ) : today ? (
                        // Some positions have no move from today yet (unpriced, or an earlier close).
                        <>
                            {formatUsd(change, { signed: true })} today on {movedToday} of {positions} positions
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
