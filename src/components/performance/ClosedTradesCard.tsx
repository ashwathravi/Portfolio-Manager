"use client";

import { useState } from "react";
import Link from "next/link";
import type { JournalEntry } from "@/types/trade";
import { MOOD_META } from "@/types/trade";
import { tradeReason } from "@/lib/journal/trades";
import { SampleTag } from "@/components/data-display/SampleTag";

/**
 * Performance › Behaviour — closed trades (launch item i51). One row per
 * sale matched against the buys before it, newest first: what it made or
 * lost, how long it was held, and why, in the user's words from Trade or
 * Research › Journal. Trades nobody wrote about say nothing rather than
 * a made-up reason.
 */

const SHOWN = 12;

function usd(n: number): string {
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function held(days: number): string {
    const whole = Math.round(days);
    if (whole < 1) return "same day";
    return `held ${whole} ${whole === 1 ? "day" : "days"}`;
}

function shares(n: number): string {
    return `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${n === 1 ? "share" : "shares"}`;
}

export interface ClosedTradesCardProps {
    trades: JournalEntry[];
    /** True when `trades` are example fixtures rather than the user's history. */
    isSample?: boolean;
}

export function ClosedTradesCard({ trades, isSample = false }: ClosedTradesCardProps) {
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? trades : trades.slice(0, SHOWN);
    const withReason = trades.filter((t) => tradeReason(t) !== null).length;

    return (
        <section className="pm-card pm-card-stack" data-testid="closed-trades" aria-labelledby="pm-closed-trades-head">
            <header className="pm-card-header">
                <div>
                    <h2 id="pm-closed-trades-head" className="pm-card-title">
                        Closed trades {isSample && <SampleTag />}
                    </h2>
                    <p className="pm-card-subtitle" data-testid="closed-trades-summary">
                        {trades.length} {trades.length === 1 ? "sale" : "sales"} matched against the buys before them,
                        oldest shares first · {withReason} with a reason you recorded
                    </p>
                </div>
            </header>

            <ul className="pm-activity-list">
                {shown.map((t) => {
                    const mood = t.rationale ? MOOD_META.find((m) => m.value === t.rationale!.mood) : undefined;
                    const reason = tradeReason(t);
                    return (
                        <li key={t.id} className="pm-closed-trade" data-testid="closed-trade">
                            <div className="pm-activity-text">
                                <span className="pm-activity-headline">
                                    <Link href={`/portfolios/detail/${encodeURIComponent(t.ticker)}`}>{t.ticker}</Link>
                                    {t.account ? ` · ${t.account}` : ""}
                                </span>
                                <span className="pm-activity-meta">
                                    Closed {day(t.closedAt)} · {held(t.holdingPeriodDays)} · {shares(t.quantity)}
                                    {mood ? ` · ${mood.emoji} ${mood.label}` : ""}
                                </span>
                                {reason && (
                                    <span className="pm-closed-trade-why" data-testid="closed-trade-why">
                                        {reason}
                                    </span>
                                )}
                            </div>
                            <span
                                className={`pm-activity-amount ${t.realizedPnlUsd >= 0 ? "pm-activity-amount-pos" : "pm-activity-amount-neg"}`}
                                data-testid="closed-trade-pnl"
                            >
                                {usd(t.realizedPnlUsd)}
                            </span>
                        </li>
                    );
                })}
            </ul>

            {withReason < trades.length && !isSample && (
                <p className="pm-card-subtitle" data-testid="closed-trades-hint">
                    A trade gets its reason from the rationale you record when you draft the order on{" "}
                    <Link href="/execution">Trade</Link> and mark it placed, or from an entry decision in{" "}
                    <Link href="/research?tab=journal">Research › Journal</Link> for that ticker in the week before the buy.
                </p>
            )}

            {trades.length > SHOWN && (
                <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setExpanded((v) => !v)} data-testid="closed-trades-toggle">
                    {expanded ? "Show fewer" : `Show all ${trades.length}`}
                </button>
            )}
        </section>
    );
}
