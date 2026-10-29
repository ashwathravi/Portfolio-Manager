"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { RiskPolicyNextAction } from "@/lib/risk-policy";
import { useThesisStore } from "@/lib/research/useThesisStore";
import { isSeedThesis } from "@/lib/research/thesis";
import { buildTriage } from "@/lib/today/triage";
import { currentWeekBounds } from "@/lib/reviews/weeks";
import { generateReview } from "@/lib/reviews/generate";
import { getReviewState, isReviewActive, reviewStateId } from "@/lib/reviews/storage";
import { getSeedJournal } from "@/lib/journal/seed";
import { SampleTag } from "@/components/data-display/SampleTag";
import type { JournalEntry } from "@/types/trade";
import { useShowSampleData } from "@/lib/hooks/useShowSampleData";

const SEVERITY_LABEL = { breach: "Breach", warn: "Review", info: "FYI" } as const;

/**
 * "Needs you" — a short ranked list of things to act on today: risk
 * policy breaches from your real holdings, theses due for review, and the
 * weekly review. Each row has one link. Items derived from example data
 * carry a Sample tag (and disappear when examples are hidden).
 */
export function TodayTriage({
    policyActions,
    reviewEntries,
}: {
    policyActions: RiskPolicyNextAction[];
    /** The user's closed trades (launch item i51); the example journal's review when omitted. */
    reviewEntries?: JournalEntry[];
}) {
    const { theses } = useThesisStore();
    const showSample = useShowSampleData();
    const [mountedNow, setMountedNow] = useState<number | null>(null);
    const [reviewDue, setReviewDue] = useState(false);

    useEffect(() => {
        const now = Date.now();
        const review = generateReview(reviewEntries ?? getSeedJournal(now), currentWeekBounds(new Date(now)));
        // A week the user closed no trades in has nothing to review.
        const quiet = reviewEntries !== undefined && review.stats.tradeCount.total === 0;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only clock + localStorage state
        setMountedNow(now);
        setReviewDue(!quiet && isReviewActive(getReviewState(reviewStateId(review.id, reviewEntries ? "trades" : "example")), now));
    }, [reviewEntries]);

    const items = useMemo(() => {
        if (mountedNow === null) return null;
        return buildTriage({
            policyActions,
            theses,
            isSampleThesis: isSeedThesis,
            reviewDue,
            reviewIsSample: reviewEntries === undefined,
            now: mountedNow,
        }).filter((item) => showSample || !item.sample);
    }, [policyActions, theses, reviewDue, reviewEntries, mountedNow, showSample]);

    return (
        <section className="pm-card pm-card-stack pm-today-triage" data-testid="today-triage" aria-labelledby="pm-today-triage-head">
            <header className="pm-today-section-head">
                <h2 id="pm-today-triage-head" className="pm-card-title">Needs your attention</h2>
                {items && <span className="pm-card-subtitle">{items.length === 0 ? "Nothing right now" : `${items.length} item${items.length === 1 ? "" : "s"}`}</span>}
            </header>
            {items === null ? (
                <p className="pm-empty-line">Checking…</p>
            ) : items.length === 0 ? (
                <p className="pm-empty-line" data-testid="today-triage-empty">You&apos;re clear. No policy breaches, stale theses, or reviews waiting.</p>
            ) : (
                <ol className="pm-triage-list">
                    {items.map((item) => (
                        <li key={item.id} data-severity={item.severity} data-testid="today-triage-item">
                            <span className="pm-triage-sev">{SEVERITY_LABEL[item.severity]}</span>
                            <span className="pm-triage-text">
                                <Link href={item.href} className="pm-triage-title">
                                    {item.title}
                                    <ArrowUpRight size={13} aria-hidden="true" />
                                </Link>
                                <span className="pm-card-subtitle">{item.detail}</span>
                            </span>
                            {item.sample && <SampleTag />}
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
