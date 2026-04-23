"use client";

import { useMemo } from "react";
import {
    computePeriodMetrics,
    type MonthlyValuation,
    type PeriodKey,
} from "@/lib/performance/periodSummary";

/**
 * Phase 4 (AR-76) Metrics-by-period table.
 *
 * One row per period, driven by `computePeriodMetrics`. Columns:
 *   Period · Return · Bench · Alpha · Vol · Sharpe · Max DD
 *
 * All percentages are colored by sign. Keeping the table stateless makes
 * it trivial to embed inside any deep-dive card later.
 */

const PERIODS: readonly PeriodKey[] = ["1M", "3M", "6M", "YTD", "1Y", "ALL"];

export interface MetricsByPeriodTableProps {
    portfolio: MonthlyValuation[];
    benchmark: MonthlyValuation[];
}

export function MetricsByPeriodTable({
    portfolio,
    benchmark,
}: MetricsByPeriodTableProps) {
    const rows = useMemo(
        () => computePeriodMetrics(portfolio, benchmark, PERIODS),
        [portfolio, benchmark],
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
                    {rows.map((r) => (
                        <tr key={r.period}>
                            <td style={{ fontWeight: 600 }}>{r.period}</td>
                            <td
                                className={`num ${r.return < 0 ? "pm-num-neg" : "pm-num-pos"}`}
                            >
                                {fmtPct(r.return)}
                            </td>
                            <td className="num" style={{ color: "var(--pm-fg-subtle)" }}>
                                {fmtPct(r.benchmark)}
                            </td>
                            <td
                                className={`num ${r.alpha < 0 ? "pm-num-neg" : "pm-num-pos"}`}
                            >
                                {fmtPct(r.alpha)}
                            </td>
                            <td className="num">{fmtPct(r.volatility)}</td>
                            <td className="num">{r.sharpe.toFixed(2)}</td>
                            <td className="num pm-num-neg">{fmtPct(r.maxDrawdown)}</td>
                        </tr>
                    ))}
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
