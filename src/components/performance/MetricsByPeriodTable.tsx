"use client";

import { useMemo } from "react";
import {
    computePeriodMetrics,
    type DatedValue,
    type PeriodKey,
} from "@/lib/performance/periodSummary";

/**
 * Phase 4 (AR-76) Metrics-by-period table.
 *
 * One row per period, driven by `computePeriodMetrics`. Columns:
 *   Period · Return · Bench · Alpha · Vol · Sharpe · Max DD
 *
 * All percentages are colored by sign. A period the history doesn't reach
 * back to shows dashes rather than the shorter span's numbers, and so does
 * a benchmark without a value at the period's ends, and volatility and
 * Sharpe over too few returns to mean anything. Keeping the table
 * stateless makes it trivial to embed inside any deep-dive card later.
 */

const PERIODS: readonly PeriodKey[] = ["1M", "3M", "6M", "YTD", "1Y", "ALL"];

export interface MetricsByPeriodTableProps {
    portfolio: DatedValue[];
    benchmark: DatedValue[];
    /** Observations per year: 12 for month ends, 252 for daily closes. */
    periodsPerYear: number;
}

const DASH = "—";

export function MetricsByPeriodTable({
    portfolio,
    benchmark,
    periodsPerYear,
}: MetricsByPeriodTableProps) {
    const rows = useMemo(
        () => computePeriodMetrics(portfolio, benchmark, PERIODS, { periodsPerYear }),
        [portfolio, benchmark, periodsPerYear],
    );

    return (
        <section
            className="pm-card pm-card-stack"
            style={{ overflowX: "auto" }}
        >
            <header>
                <h2 className="pm-card-title">Metrics by period</h2>
                <p className="pm-card-subtitle">
                    Return, alpha, volatility, and drawdown across standard windows
                </p>
            </header>
            <table className="pm-table-full">
                <thead>
                    <tr>
                        <th>Period</th>
                        <th className="num">Return</th>
                        <th className="num">Bench</th>
                        <th className="num">Alpha</th>
                        <th className="num">Vol</th>
                        <th className="num">Sharpe</th>
                        <th className="num">Max DD</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) =>
                        r.covered ? (
                            <tr key={r.period}>
                                <td style={{ fontWeight: 600 }}>{r.period}</td>
                                <td
                                    className={`num ${r.return < 0 ? "pm-num-neg" : "pm-num-pos"}`}
                                >
                                    {fmtPct(r.return)}
                                </td>
                                <td className="num" style={{ color: "var(--pm-fg-subtle)" }}>
                                    {r.benchmark === null ? DASH : fmtPct(r.benchmark)}
                                </td>
                                <td
                                    className={`num ${r.alpha === null ? "" : r.alpha < 0 ? "pm-num-neg" : "pm-num-pos"}`}
                                >
                                    {r.alpha === null ? DASH : fmtPct(r.alpha)}
                                </td>
                                <td className="num">{r.volatility === null ? DASH : fmtPct(r.volatility)}</td>
                                <td className="num">{r.sharpe === null ? DASH : r.sharpe.toFixed(2)}</td>
                                <td className="num pm-num-neg">{fmtPct(r.maxDrawdown)}</td>
                            </tr>
                        ) : (
                            <tr key={r.period} title={`Less than ${r.period} of history`}>
                                <td style={{ fontWeight: 600 }}>{r.period}</td>
                                {Array.from({ length: 6 }, (_, i) => (
                                    <td key={i} className="num" style={{ color: "var(--pm-fg-subtle)" }}>
                                        {DASH}
                                    </td>
                                ))}
                            </tr>
                        ),
                    )}
                </tbody>
            </table>
        </section>
    );
}

function fmtPct(x: number): string {
    if (!Number.isFinite(x)) return "0.00%";
    const pct = x * 100;
    const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
    return `${sign}${Math.abs(pct).toFixed(2)}%`;
}
