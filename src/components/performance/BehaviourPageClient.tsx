"use client";

import { useEffect, useState } from "react";
import { SEED_JOURNAL } from "@/lib/journal/seed";
import { SampleDataNotice } from "@/components/data-display/SampleDataNotice";
import { SampleEmptyState } from "@/components/data-display/SampleEmptyState";
import { SampleGate } from "@/components/data-display/SampleGate";
import { TradingCalendarCard } from "./TradingCalendarCard";
import { MoodBreakdownCard } from "./MoodBreakdownCard";
import { PnlDensityCard } from "./PnlDensityCard";
import { ReviewsArchiveCard } from "./ReviewsArchiveCard";

/**
 * Performance › Behaviour — how you trade, separate from whether you made
 * money. Absorbs the retired /analytics page (trading calendar) alongside
 * the mood, time-of-day, and weekly-review cards that used to sit at the
 * bottom of the Returns view.
 */
export function BehaviourPageClient() {
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

    return (
        <div className="pm-perf-stack">
            <SampleGate
                fallback={
                    <SampleEmptyState
                        title="No closed trades yet"
                        body="The trading calendar, mood breakdown, and time-of-day patterns are built from your closed trades and journal. Connect an account to start."
                    />
                }
            >
                <SampleDataNotice>
                    Closed trades below come from the example journal until your trade history is connected.
                </SampleDataNotice>
                <TradingCalendarCard trades={SEED_JOURNAL} isSample />
                <MoodBreakdownCard trades={SEED_JOURNAL} />
                <PnlDensityCard trades={SEED_JOURNAL} />
                <ReviewsArchiveCard entries={SEED_JOURNAL} />
            </SampleGate>
        </div>
    );
}
