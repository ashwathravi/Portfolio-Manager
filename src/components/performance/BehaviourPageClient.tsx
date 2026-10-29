"use client";

import { useEffect, useState } from "react";
import { getSeedJournal } from "@/lib/journal/seed";
import type { TradeJournal } from "@/lib/journal/trades";
import { DEFAULT_NAV } from "@/lib/reviews/generate";
import { SampleDataNotice } from "@/components/data-display/SampleDataNotice";
import { SampleEmptyState } from "@/components/data-display/SampleEmptyState";
import { SampleGate } from "@/components/data-display/SampleGate";
import type { JournalEntry } from "@/types/trade";
import { TradingCalendarCard } from "./TradingCalendarCard";
import { ClosedTradesCard } from "./ClosedTradesCard";
import { MoodBreakdownCard } from "./MoodBreakdownCard";
import { PnlDensityCard } from "./PnlDensityCard";
import { ReviewsArchiveCard } from "./ReviewsArchiveCard";

/**
 * Performance › Behaviour — how you trade, separate from whether you made
 * money. Absorbs the retired /analytics page (trading calendar) alongside
 * the mood, time-of-day, and weekly-review cards that used to sit at the
 * bottom of the Returns view.
 *
 * `journal` is the user's closed trades (launch item i51); without any,
 * the example journal stands in, labelled, while examples are shown.
 * Tickers left out of the matching are named either way, so trades the
 * user did import never silently vanish.
 */
export function BehaviourPageClient({ journal }: { journal: TradeJournal | null }) {
    // These cards bucket trades by the viewer's local day, hour, and week,
    // so they render after mount; a server render in another timezone
    // would otherwise fail hydration.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only render gate
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div className="pm-perf-stack" aria-busy="true">
                <p className="pm-empty-line">Loading your trading patterns…</p>
            </div>
        );
    }

    const leftOut = journal && journal.leftOut.length > 0 && (
        <p className="pm-perf-history-note" data-testid="behaviour-left-out">
            Left out: {journal.leftOut.join(", ")}. A trade in {journal.leftOut.length === 1 ? "it" : "them"} is
            far from that day&apos;s split-adjusted close, so a split likely changed the share count and its
            buys and sales can&apos;t be matched.
        </p>
    );

    if (journal && journal.entries.length > 0) {
        return (
            <div className="pm-perf-stack">
                {leftOut}
                <BehaviourCards trades={journal.entries} nav={journal.netWorth} />
            </div>
        );
    }

    return (
        <div className="pm-perf-stack">
            {leftOut}
            <SampleGate
                fallback={
                    <SampleEmptyState
                        title={leftOut ? "No closed trades to show" : "No closed trades yet"}
                        body="The trading calendar, mood breakdown and weekly reviews are built from your closed trades: each sale matched against the buys before it. Add your trades on Activity, import them, or link an account to start."
                    />
                }
            >
                <SampleDataNotice>
                    Closed trades below come from the example journal until you have closed trades of your own.
                </SampleDataNotice>
                <BehaviourCards trades={getSeedJournal()} nav={DEFAULT_NAV} isSample />
            </SampleGate>
        </div>
    );
}

function BehaviourCards({ trades, nav, isSample = false }: { trades: JournalEntry[]; nav: number; isSample?: boolean }) {
    return (
        <>
            <TradingCalendarCard trades={trades} isSample={isSample} />
            <ClosedTradesCard trades={trades} isSample={isSample} />
            <MoodBreakdownCard trades={trades} />
            <PnlDensityCard trades={trades} />
            <ReviewsArchiveCard entries={trades} nav={nav} isSample={isSample} />
        </>
    );
}
