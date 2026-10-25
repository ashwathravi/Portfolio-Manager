"use client";

import { useMemo } from "react";
import { DAILY } from "@/lib/performance/periodSummary";
import type { ReturnHistory } from "@/lib/performance/return-history";
import type { Benchmark } from "./EquityCurveCard";
import { ReturnsCards } from "./PerformancePageClient";
import { AccountSwitcher } from "./AccountSwitcher";

/**
 * Performance › Returns from the user's own history (launch item i49): the
 * time-weighted return of one account, or all of them together, from
 * their nightly valuations, beside the benchmark ETFs. The account is in
 * the URL (`?account=`), so the server renders its series and the CSV
 * export holds the same rows.
 */
export function ReturnHistoryView({ history }: { history: ReturnHistory }) {
    const { accounts, accountId, points, benchmarks } = history;

    // A step across missed sessions spans several: risk measures scale it back to one.
    const portfolio = useMemo(
        () => points.map((p) => ({ date: p.date, value: p.index, periods: Math.max(1, p.sessions) })),
        [points],
    );
    const benchmarkSeries = useMemo<Benchmark[]>(
        () => benchmarks.map((b) => ({ key: b.key, label: b.label, series: b.values })),
        [benchmarks],
    );
    const estimated = points.filter((p) => p.unpriced.length > 0);
    const unpricedSymbols = [...new Set(estimated.flatMap((p) => p.unpriced))].sort();
    const accountName = accounts.find((a) => a.id === accountId)?.name ?? "All accounts";

    return (
        <div className="pm-perf-stack">
            <div className="pm-perf-history-bar">
                <AccountSwitcher accounts={accounts} accountId={accountId} path="/performance" />
                {points.length >= 2 && (
                    <p className="pm-perf-history-note" data-testid="return-history-note">
                        {accountName}: {points.length} closing valuations, {fmtDate(points[0].date)} to{" "}
                        {fmtDate(points[points.length - 1].date)}. Price returns: dividends aren&apos;t included, and
                        money added, withdrawn or moved between your accounts doesn&apos;t count as a return.
                        {estimated.length > 0 &&
                            ` On ${estimated.length} ${estimated.length === 1 ? "day" : "days"} some holdings had no stored price (${listSymbols(unpricedSymbols)}), so their gain or loss isn't included.`}
                    </p>
                )}
            </div>

            {points.length >= 2 ? (
                <ReturnsCards
                    key={accountId ?? "all"}
                    portfolio={portfolio}
                    benchmarks={benchmarkSeries}
                    periodsPerYear={DAILY}
                />
            ) : (
                <section className="pm-card pm-empty-card" data-testid="return-history-empty">
                    {points.length === 1 ? (
                        <>
                            <h2>One valuation so far</h2>
                            <p>
                                {accountName} was valued at the close on {fmtDate(points[0].date)}. Returns start
                                from the next market close.
                            </p>
                        </>
                    ) : (
                        <>
                            <h2>No history for this account yet</h2>
                            <p>
                                Its first valuation is recorded at the market close after it has holdings, and
                                returns start from the next one.
                            </p>
                        </>
                    )}
                </section>
            )}
        </div>
    );
}

/** "KO, PG and 3 more" */
function listSymbols(symbols: readonly string[]): string {
    if (symbols.length <= 3) return symbols.join(", ");
    return `${symbols.slice(0, 3).join(", ")} and ${symbols.length - 3} more`;
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
