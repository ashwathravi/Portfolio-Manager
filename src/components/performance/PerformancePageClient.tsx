"use client";

import { useMemo } from "react";
import { getExampleMonthlySeries } from "@/lib/performance/series";
import { MONTHLY, type DatedValue } from "@/lib/performance/periodSummary";
import { EquityCurveCard, type Benchmark } from "./EquityCurveCard";
import { MetricsByPeriodTable } from "./MetricsByPeriodTable";
import { MonthlyHeatmapCard } from "./MonthlyHeatmapCard";
import { SampleDataNotice } from "@/components/data-display/SampleDataNotice";
import { SampleEmptyState } from "@/components/data-display/SampleEmptyState";
import { SampleGate } from "@/components/data-display/SampleGate";

/**
 * Performance › Returns. Composes:
 *   - EquityCurveCard        (AR-75, hero)
 *   - MetricsByPeriodTable   (AR-76, period × metrics matrix)
 *   - MonthlyHeatmapCard     (AR-77, year × month intensity grid)
 *
 * `ReturnsCards` renders them for any series: the user's real history
 * (ReturnHistoryView, daily closes) or, before there is any, the example
 * series here (month ends, behind "Show example data").
 *
 * Attribution has its own tab (AttributionPageClient). Behavioural cards
 * (mood, P&L density, trading calendar, weekly reviews) live on
 * Performance › Behaviour — see BehaviourPageClient.
 *
 * `now` is the server's request time, shared with the CSV export, so the
 * browser hydrates the same months and the export matches the charts.
 */

export function ReturnsCards({
    portfolio,
    benchmarks,
    periodsPerYear,
}: {
    portfolio: DatedValue[];
    benchmarks: Benchmark[];
    periodsPerYear: number;
}) {
    return (
        <>
            <EquityCurveCard portfolio={portfolio} benchmarks={benchmarks} periodsPerYear={periodsPerYear} />
            <MetricsByPeriodTable
                portfolio={portfolio}
                benchmark={benchmarks[0]?.series ?? []}
                periodsPerYear={periodsPerYear}
            />
            <MonthlyHeatmapCard portfolio={portfolio} />
        </>
    );
}

// The example series has one benchmark; scaling its *returns* (not values)
// gives the other options distinct shapes, so switching the dropdown
// actually redraws the chart.
function rescaleReturns(
    series: DatedValue[],
    factor: number,
): DatedValue[] {
    if (series.length === 0) return [];
    const out: DatedValue[] = [{ ...series[0] }];
    for (let i = 1; i < series.length; i++) {
        const prevOrig = series[i - 1].value;
        const prevOut = out[i - 1].value;
        const origRet = prevOrig === 0 ? 0 : (series[i].value - prevOrig) / prevOrig;
        out.push({
            date: series[i].date,
            value: prevOut * (1 + origRet * factor),
        });
    }
    return out;
}

function buildBenchmarks(sp500: DatedValue[]): Benchmark[] {
    return [
        { key: "sp500", label: "S&P 500", series: sp500 },
        {
            key: "ndx",
            label: "NASDAQ-100",
            series: rescaleReturns(sp500, 1.45),
        },
        {
            key: "russell",
            label: "Russell 2000",
            series: rescaleReturns(sp500, 0.72),
        },
        {
            key: "custom",
            label: "Custom blend",
            series: rescaleReturns(sp500, 1.15),
        },
    ];
}

export function PerformancePageClient({ now }: { now: number }) {
    const { portfolio, benchmark } = getExampleMonthlySeries(now);
    const benchmarks = useMemo(() => buildBenchmarks(benchmark), [benchmark]);
    return (
        <div className="pm-perf-stack">
            <SampleGate
                fallback={
                    <SampleEmptyState
                        title="No return history yet"
                        body="Returns are measured from a valuation of your accounts at each market close. The first is recorded at the close after you add holdings, and returns start from the next one."
                    />
                }
            >
                <SampleDataNotice>
                    Returns and benchmarks are example data until your accounts have valuation history.
                </SampleDataNotice>

                <ReturnsCards portfolio={portfolio} benchmarks={benchmarks} periodsPerYear={MONTHLY} />
            </SampleGate>
        </div>
    );
}
