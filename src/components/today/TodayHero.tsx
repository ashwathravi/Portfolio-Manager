"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAutoRefreshQuotes } from "@/lib/hooks/useAutoRefreshQuotes";
import { LiveDataIndicator } from "@/components/data-display/LiveDataIndicator";
import { formatPct, formatUsd } from "@/lib/format";
import { isTodaysQuote } from "@/lib/markets/quote-session";
import { useEasternDate } from "@/lib/hooks/useEasternDate";
import { todayHeadline, type NetWorthSummary } from "@/lib/portfolio/net-worth";
import type { ImportAccountOption } from "@/components/holdings/ImportHoldingsDialog";
import { FirstRunCard } from "./FirstRunCard";

export interface TodayHeroHolding {
    symbol: string;
    quantity: number;
    currentPrice: number;
    marketValue: number;
}

export interface TodayHeroProps {
    holdings: TodayHeroHolding[];
    cashTotal: number;
    /** Holdings valued by hand: their total, counted as it stands (no today's change). */
    manualTotal?: number;
    manualCount?: number;
    /** The user's accounts, for the first-run steps and the CSV import. */
    accounts: readonly ImportAccountOption[];
    /** Whether the first-run steps may offer to connect a bank (x30). */
    bankLinking: boolean;
    /**
     * The other assets and debts the user added on Accounts, added up
     * (outsideForToday): with any, the headline is the net worth.
     * "unavailable" when they couldn't be read; null when there are none, or
     * no database to keep them in.
     */
    outside?: NetWorthSummary | "unavailable" | null;
}

/**
 * Today's hero: the money. The portfolio value (positions at delayed
 * quotes or closes, labelled, plus holdings valued by hand and cash) and
 * today's change from the user's own holdings, with invested / cash /
 * positions beneath.
 *
 * Once the user has other assets or debts on Accounts (`outside`), the
 * headline is their net worth instead: the portfolio value plus those
 * assets, less those debts, with the portfolio value under it and a note on
 * how old the values given are. Today's change is still the portfolio's.
 * If they can't be read, the headline stays the portfolio value, labelled as
 * such, with a line saying why. Which one leads, and what the note and that
 * line say, is todayHeadline's (net-worth.ts).
 *
 * No illustrative sparklines or hardcoded deltas — the old stat row showed
 * "+1.2% vs last month" regardless of data. Without any positions it is the
 * first-run card (FirstRunCard), whatever else the user has entered: the
 * steps to an account with positions in it.
 */
export function TodayHero({
    holdings,
    cashTotal,
    manualTotal = 0,
    manualCount = 0,
    accounts,
    bankLinking,
    outside = null,
}: TodayHeroProps) {
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

    const portfolioValue = invested + manualTotal + cashTotal;
    const headline = todayHeadline(portfolioValue, outside);
    const worth = headline.netWorth;
    const liveIndicator = (
        <div className="pm-today-hero-live">
            <LiveDataIndicator
                isFetching={isFetching}
                isError={isError && !live}
                refreshMs={refreshMs}
                lastUpdatedAt={lastUpdatedAt}
                onRefresh={() => void refetch()}
                quotes={quotes}
            />
        </div>
    );
    // A share of the portfolio value, never of the net worth.
    const changePct = portfolioValue - change > 0 ? (change / (portfolioValue - change)) * 100 : 0;

    if (holdings.length === 0 && manualCount === 0) return <FirstRunCard accounts={accounts} cashTotal={cashTotal} bankLinking={bankLinking} />;

    return (
        <section className="pm-card pm-today-hero" data-testid="today-hero" aria-label={headline.label}>
            <div className="pm-today-hero-main">
                <span className="pm-today-label">{headline.label}</span>
                {worth ? (
                    <>
                        <p className="pm-today-networth" data-testid="today-net-worth">{formatUsd(worth.value)}</p>
                        <p className="pm-today-portfolio" data-testid="today-portfolio">
                            <span>Portfolio value</span> <span data-testid="today-portfolio-value">{formatUsd(portfolioValue)}</span>
                        </p>
                    </>
                ) : (
                    <p className="pm-today-networth" data-testid="today-portfolio-value">{formatUsd(portfolioValue)}</p>
                )}
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
                        "Today's change appears once prices arrive"
                    )}
                </p>
            </div>
            <dl className="pm-today-hero-facts">
                <div><dt>Invested</dt><dd>{formatUsd(invested + manualTotal, { decimals: 0 })}</dd></div>
                <div><dt>Cash</dt><dd>{formatUsd(cashTotal, { decimals: 0 })}</dd></div>
                <div><dt>Positions</dt><dd>{holdings.length + manualCount}</dd></div>
                {manualCount > 0 && (
                    <div data-testid="today-manual"><dt>Valued by hand</dt><dd>{formatUsd(manualTotal, { decimals: 0 })}</dd></div>
                )}
                {worth && (
                    <>
                        <div data-testid="today-other-assets"><dt>Other assets</dt><dd>{formatUsd(worth.items.otherAssets, { decimals: 0 })}</dd></div>
                        {/* A debt is owed, not lost: a minus sign, never red. */}
                        <div data-testid="today-debts"><dt>Debts</dt><dd>{formatUsd(-worth.items.debts, { decimals: 0 })}</dd></div>
                    </>
                )}
            </dl>
            {worth && (
                <p className="pm-today-hero-note" data-testid="today-net-worth-note">
                    Other assets and debts are at the values you gave on{" "}
                    <Link href="/portfolios/accounts#other-assets">Accounts</Link>
                    {`, ${worth.asOf}.`}
                </p>
            )}
            {headline.unavailable && (
                <p className="pm-today-hero-note" data-testid="today-net-worth-unavailable">{headline.unavailable}</p>
            )}
            {liveIndicator}
        </section>
    );
}
