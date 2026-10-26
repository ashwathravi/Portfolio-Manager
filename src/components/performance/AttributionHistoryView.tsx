"use client";

import { useMemo, useState } from "react";
import type { AttributionSummary } from "@/lib/performance/attribution";
import { linkAttribution, linkingProblem, type AttributionBasis } from "@/lib/performance/attribution-link";
import type { AttributionHistory } from "@/lib/performance/attribution-loader";
import { sliceForPeriod, type PeriodKey } from "@/lib/performance/periodSummary";
import { AccountSwitcher } from "./AccountSwitcher";
import { AttributionBarsCard } from "./AttributionBarsCard";
import { AttributionLede } from "./AttributionPageClient";
import { AttributionTableCard } from "./AttributionTableCard";

/**
 * Performance › Attribution from the user's own history (launch item i50):
 * what explains the gap between their time-weighted return and the S&P 500
 * by sector, over a period, for all accounts or the one in `?account=`.
 * The steps come from the server; the period's are linked here.
 */

const PERIODS: readonly PeriodKey[] = ["1M", "3M", "6M", "YTD", "1Y", "ALL"];

/** Only the segments the portfolio or the benchmark holds. */
function held(summary: AttributionSummary): AttributionSummary {
    return { ...summary, segments: summary.segments.filter((s) => s.portfolioWeight !== 0 || s.benchmarkWeight !== 0) };
}

export function AttributionHistoryView({ history }: { history: AttributionHistory }) {
    const { accounts, accountId, dates, steps, benchmark } = history;
    const accountName = accounts.find((a) => a.id === accountId)?.name ?? "All accounts";

    const points = useMemo(() => dates.map((date) => ({ date, value: 1 })), [dates]);
    const covered = useMemo(() => new Set(PERIODS.filter((p) => sliceForPeriod(points, p).covered)), [points]);
    const [chosen, setPeriod] = useState<PeriodKey>(() => (covered.has("1Y") ? "1Y" : "ALL"));
    // A period the history doesn't reach back to is never measured (its
    // button is disabled): the page is remounted per account, and this
    // catches anything else that leaves an uncovered one chosen.
    const period: PeriodKey = covered.has(chosen) ? chosen : "ALL";

    const periodSteps = useMemo(() => {
        const start = sliceForPeriod(points, period).points[0]?.date ?? "";
        return steps.filter((step) => step.from >= start);
    }, [points, period, steps]);
    const problem = useMemo(() => (benchmark ? linkingProblem(periodSteps, benchmark.segments) : null), [periodSteps, benchmark]);
    const summaries = useMemo(() => {
        if (!benchmark || problem) return null;
        const link = (basis: AttributionBasis) => held(linkAttribution(periodSteps, basis, benchmark.segments));
        return { sector: link("sector"), assetClass: link("assetClass") };
    }, [periodSteps, benchmark, problem]);
    const unattributed = periodSteps.filter((step) => step.benchmarkSectorReturns === null).length;

    let body: React.ReactNode;
    if (dates.length < 2) {
        body = (
            <section className="pm-card pm-empty-card" data-testid="attribution-empty">
                <h2>{dates.length === 1 ? "One valuation so far" : "No history for this account yet"}</h2>
                <p>
                    Attribution compares what you held, and how it did, with the S&amp;P 500 between your nightly
                    valuations. It starts once there are two.
                </p>
            </section>
        );
    } else if (benchmark && problem === "no-steps") {
        body = (
            <section className="pm-card pm-empty-card" data-testid="attribution-unavailable">
                <h2>No sector prices for this period</h2>
                <p>
                    None of the days in this period has the sector ETFs&apos; closes at both ends, so there is
                    nothing to compare with. Try a longer period, or check back after the next nightly price run.
                </p>
            </section>
        );
    } else if (benchmark && problem === "total-loss") {
        body = (
            <section className="pm-card pm-empty-card" data-testid="attribution-unavailable">
                <h2>Attribution isn&apos;t available for this period</h2>
                <p>
                    On at least one day the accounts lost all of their value or more (a margin balance), and
                    returns can&apos;t be compared across a loss that large. Try a period after it.
                </p>
            </section>
        );
    } else if (!summaries || !benchmark) {
        body = (
            <section className="pm-card pm-empty-card" data-testid="attribution-waiting">
                <h2>Waiting for sector prices</h2>
                <p>
                    The S&amp;P 500&apos;s sector weights are estimated from about three months of the sector ETFs&apos;
                    prices, which the nightly job is still fetching. Attribution appears once they&apos;re in.
                </p>
            </section>
        );
    } else {
        body = (
            <>
                <AttributionLede summary={summaries.sector} />
                <AttributionBarsCard sector={summaries.sector} assetClass={summaries.assetClass} />
                <AttributionTableCard sector={summaries.sector} assetClass={summaries.assetClass} />
            </>
        );
    }

    return (
        <div className="pm-perf-stack">
            <div className="pm-perf-history-bar">
                <AccountSwitcher accounts={accounts} accountId={accountId} path="/performance/attribution" />
                {dates.length >= 2 && (
                    <div role="radiogroup" aria-label="Period" className="pm-seg-pill">
                        {PERIODS.map((p) => (
                            <button
                                key={p}
                                type="button"
                                role="radio"
                                aria-checked={period === p}
                                className="pm-seg-pill-btn"
                                disabled={!covered.has(p) && p !== "ALL"}
                                title={!covered.has(p) && p !== "ALL" ? `Less than ${p} of history` : undefined}
                                onClick={() => setPeriod(p)}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                )}
                {summaries && benchmark && (
                    <p className="pm-perf-history-note" data-testid="attribution-note">
                        {accountName}, {fmtDate(periodSteps[0].from)} to {fmtDate(periodSteps[periodSteps.length - 1].to)}, against the
                        S&amp;P 500 by sector: each sector&apos;s SPDR ETF, weighted as SPY moved with them over the
                        last {benchmark.returns} sessions. Price returns: dividends aren&apos;t included.
                        {unattributed > 0 &&
                            ` ${unattributed} ${unattributed === 1 ? "step" : "steps"} without sector prices ${unattributed === 1 ? "is" : "are"} left out.`}
                    </p>
                )}
            </div>
            {body}
        </div>
    );
}

/** "Aug 31, 2026" for a YYYY-MM-DD date, the same on server and client. */
function fmtDate(date: string): string {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    });
}
