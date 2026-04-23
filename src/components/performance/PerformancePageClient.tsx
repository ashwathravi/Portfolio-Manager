"use client";

import Link from "next/link";
import { ArrowUpRight, Download } from "lucide-react";
import {
    benchmarkMonthlySeries,
    portfolioMonthlySeries,
} from "@/lib/performance/series";
import type { MonthlyValuation } from "@/lib/performance/periodSummary";
import { EquityCurveCard, type Benchmark } from "./EquityCurveCard";

/**
 * Phase 4 (AR-75) Performance page wrapper — AR-75 state.
 *
 * Initial slice ships just the Equity curve hero card. Attribution bars,
 * metrics-by-period table, and monthly heatmap land in AR-76 and AR-77.
 *
 * All state is local to each card. The client wrapper exists purely to
 * keep the page file thin and to keep the topbar / breadcrumbs / actions
 * in sync with the rest of the Workspace routes.
 */

// Derive alt benchmarks from the single live series we have until AR-11/12
// wires up real benchmark feeds. Scaling *returns* (not values) keeps the
// shape distinct for each option so switching the dropdown actually
// redraws the chart.
function rescaleReturns(
    series: MonthlyValuation[],
    factor: number,
): MonthlyValuation[] {
    if (series.length === 0) return [];
    const out: MonthlyValuation[] = [{ ...series[0] }];
    for (let i = 1; i < series.length; i++) {
        const prevOrig = series[i - 1].value;
        const prevOut = out[i - 1].value;
        const origRet = prevOrig === 0 ? 0 : (series[i].value - prevOrig) / prevOrig;
        out.push({
            year: series[i].year,
            month: series[i].month,
            value: prevOut * (1 + origRet * factor),
        });
    }
    return out;
}

const BENCHMARKS: Benchmark[] = [
    { key: "sp500", label: "S&P 500", series: benchmarkMonthlySeries },
    {
        key: "ndx",
        label: "NASDAQ-100",
        series: rescaleReturns(benchmarkMonthlySeries, 1.45),
    },
    {
        key: "russell",
        label: "Russell 2000",
        series: rescaleReturns(benchmarkMonthlySeries, 0.72),
    },
    {
        key: "custom",
        label: "Custom blend",
        series: rescaleReturns(benchmarkMonthlySeries, 1.15),
    },
];

export function PerformancePageClient() {
    return (
        <div className="pm-perf-stack">
            <header className="pm-perf-topbar">
                <div>
                    <nav className="pm-crumbs" aria-label="Breadcrumb">
                        <Link href="/">Workspace</Link>
                        <span className="pm-crumbs-sep">/</span>
                        <span aria-current="page">Performance</span>
                    </nav>
                    <h1 className="pm-page-title">Performance analytics</h1>
                    <p className="pm-page-sub">
                        Time-weighted return, risk metrics, and attribution
                    </p>
                </div>
                <div className="pm-topbar-actions">
                    <Link
                        href="/portfolios/holdings"
                        className="pm-btn pm-btn-ghost"
                    >
                        <ArrowUpRight size={14} aria-hidden="true" />
                        <span>Holdings</span>
                    </Link>
                    <button type="button" className="pm-btn pm-btn-ghost" disabled>
                        <Download size={14} aria-hidden="true" />
                        <span>Export</span>
                    </button>
                </div>
            </header>

            <EquityCurveCard
                portfolio={portfolioMonthlySeries}
                benchmarks={BENCHMARKS}
            />
        </div>
    );
}
