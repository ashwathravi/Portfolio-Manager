"use client";

import {
    benchmarkMonthlySeries,
    portfolioMonthlySeries,
} from "@/lib/performance/series";
import {
    defaultAssetClassBreakdown,
    defaultSectorBreakdown,
} from "@/lib/performance/attribution";
import type { MonthlyValuation } from "@/lib/performance/periodSummary";
import { EquityCurveCard, type Benchmark } from "./EquityCurveCard";
import { AttributionBarsCard } from "./AttributionBarsCard";
import { MetricsByPeriodTable } from "./MetricsByPeriodTable";
import { MonthlyHeatmapCard } from "./MonthlyHeatmapCard";
import { SampleDataNotice } from "@/components/data-display/SampleDataNotice";
import { SampleEmptyState } from "@/components/data-display/SampleEmptyState";
import { SampleGate } from "@/components/data-display/SampleGate";

/**
 * Performance page wrapper.
 *
 * Performance › Returns. Composes:
 *   - EquityCurveCard        (AR-75, hero)
 *   - AttributionBarsCard    (AR-76, BHB decomposition)
 *   - MetricsByPeriodTable   (AR-76, period × metrics matrix)
 *   - MonthlyHeatmapCard     (AR-77, year × month intensity grid)
 *
 * Behavioural cards (mood, P&L density, trading calendar, weekly reviews)
 * live on Performance › Behaviour — see BehaviourPageClient.
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
            <SampleGate
                fallback={
                    <SampleEmptyState
                        title="No return history yet"
                        body="Time-weighted returns, benchmark comparison, and attribution need your account history. Connect an account to start tracking."
                    />
                }
            >
                <SampleDataNotice>
                    Returns, benchmarks, and attribution are example data until account history is connected.
                </SampleDataNotice>

                <EquityCurveCard
                    portfolio={portfolioMonthlySeries}
                    benchmarks={BENCHMARKS}
                />

                <div className="pm-perf-split">
                    <AttributionBarsCard
                        sectors={defaultSectorBreakdown}
                        assetClasses={defaultAssetClassBreakdown}
                    />
                    <MetricsByPeriodTable
                        portfolio={portfolioMonthlySeries}
                        benchmark={benchmarkMonthlySeries}
                    />
                </div>

                <MonthlyHeatmapCard portfolio={portfolioMonthlySeries} />
            </SampleGate>
        </div>
    );
}
