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
import { getReviewState, isReviewActive } from "@/lib/reviews/storage";
import { SEED_JOURNAL } from "@/lib/journal/seed";
import { SampleTag } from "@/components/data-display/SampleTag";
import { useShowSampleData } from "@/lib/hooks/useShowSampleData";

const SEVERITY_LABEL = { breach: "Breach", warn: "Review", info: "FYI" } as const;

/**
 * "Needs you" — a short ranked list of things to act on today: risk
 * policy breaches from your real holdings, theses due for review, and the
 * weekly review. Each row has one link. Items derived from example data
 * carry a Sample tag (and disappear when examples are hidden).
 */
export function TodayTriage({ policyActions }: { policyActions: RiskPolicyNextAction[] }) {
    const { theses } = useThesisStore();
    const showSample = useShowSampleData();
    const [mountedNow, setMountedNow] = useState<number | null>(null);
    const [reviewDue, setReviewDue] = useState(false);

    useEffect(() => {
        const now = Date.now();
        const review = generateReview(SEED_JOURNAL, currentWeekBounds(new Date(now)));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only clock + localStorage state
        setMountedNow(now);
        setReviewDue(isReviewActive(getReviewState(review.id), now));
    }, []);

    const items = useMemo(() => {
        if (mountedNow === null) return null;
        return buildTriage({
            policyActions,
            theses,
            isSampleThesis: isSeedThesis,
            reviewDue,
            reviewIsSample: true,
            now: mountedNow,
        }).filter((item) => showSample || !item.sample);
    }, [policyActions, theses, reviewDue, mountedNow, showSample]);

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
