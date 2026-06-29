"use client";

import { useMemo, useState } from "react";
import { AreaChart, type AreaChartRange } from "@/components/charts";
import {
    computePeriodMetrics,
    computeRiskSnapshot,
    type MonthlyValuation,
    type PeriodKey,
} from "@/lib/performance/periodSummary";

/**
 * Phase 4 (AR-75) Equity curve card.
 *
 * Renders the hero chart for the Performance page:
 *   - Time-range segmented control (1M / 3M / 6M / YTD / 1Y / 3Y / ALL)
 *   - Benchmark dropdown (S&P 500, NDX, Russell 2000, Custom)
 *   - Portfolio + benchmark lines normalized to 100 at period start so the
 *     comparison stays meaningful across benchmarks with different scales.
 *   - Six readouts along the bottom: TWR, Bench, Alpha, Sharpe, Sortino,
 *     Max DD. All numbers come from `computePeriodMetrics` + `computeRiskSnapshot`
 *     so the chart and cells are internally consistent.
 */

export type EquityRange = Extract<
    AreaChartRange,
    "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "ALL"
>;

export interface Benchmark {
    key: string;
    label: string;
    series: MonthlyValuation[];
}

export interface EquityCurveCardProps {
    portfolio: MonthlyValuation[];
    benchmarks: Benchmark[];
}

const RANGES: readonly EquityRange[] = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "ALL"];
const EMPTY_BENCHMARK_SERIES: MonthlyValuation[] = [];

// Our synthetic monthly series covers ~15 months. 3Y collapses to ALL for now.
const PERIOD_FOR_RANGE: Record<EquityRange, PeriodKey> = {
    "1M": "1M",
    "3M": "3M",
    "6M": "6M",
    "YTD": "YTD",
    "1Y": "1Y",
    "3Y": "ALL",
    "ALL": "ALL",
};

export function EquityCurveCard({ portfolio, benchmarks }: EquityCurveCardProps) {
    const [range, setRange] = useState<EquityRange>("1Y");
    const [benchKey, setBenchKey] = useState(benchmarks[0]?.key ?? "");

    const activeBench =
        benchmarks.find((b) => b.key === benchKey) ?? benchmarks[0] ?? null;
    const benchSeries = activeBench?.series ?? EMPTY_BENCHMARK_SERIES;

    const periodKey = PERIOD_FOR_RANGE[range];

    // Slice both series for the selected period. We replicate the slice
    // logic from periodSummary.ts here because the private helper isn't
    // exported — keeping it local lets us rescale the chart independently.
    const { slicePortfolio, sliceBench } = useMemo(() => {
        const wanted = wantedMonthsForPeriod(periodKey, portfolio);
        const pStart = Math.max(0, portfolio.length - 1 - wanted);
        const bStart = Math.max(0, benchSeries.length - 1 - wanted);
        return {
            slicePortfolio: portfolio.slice(pStart),
            sliceBench: benchSeries.slice(bStart),
        };
    }, [portfolio, benchSeries, periodKey]);

    // TWR / bench / alpha / sharpe / max DD for the period come from the
    // calculation engine. Sortino comes from the risk snapshot over the same
    // slice so it's consistent with the visible chart.
    const readouts = useMemo(() => {
        const [metric] = computePeriodMetrics(portfolio, benchSeries, [periodKey]);
        const risk = computeRiskSnapshot(slicePortfolio, sliceBench);
        return {
            twr: metric?.return ?? 0,
            bench: metric?.benchmark ?? 0,
            alpha: metric?.alpha ?? 0,
            sharpe: metric?.sharpe ?? 0,
            sortino: risk.sortinoRatio,
            maxDd: metric?.maxDrawdown ?? 0,
        };
    }, [portfolio, benchSeries, slicePortfolio, sliceBench, periodKey]);

    const portfolioNormalized = normalizeTo100(slicePortfolio.map((p) => p.value));
    const benchNormalized = normalizeTo100(sliceBench.map((p) => p.value));

    return (
        <section className="pm-card pm-card-stack pm-perf-equity-card">
            <header className="pm-perf-equity-head">
                <div>
                    <h2 className="pm-card-title">Equity curve</h2>
                    <p className="pm-card-subtitle">
                        Time-weighted return vs {activeBench?.label ?? "benchmark"},
                        rebased to 100 at period start
                    </p>
                </div>
                <div className="pm-perf-equity-controls">
                    <div
                        role="radiogroup"
                        aria-label="Time range"
                        className="pm-seg-pill"
                    >
                        {RANGES.map((r) => (
                            <button
                                key={r}
                                type="button"
                                role="radio"
                                aria-checked={range === r}
                                className="pm-seg-pill-btn"
                                onClick={() => setRange(r)}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                    <label className="pm-perf-bench-select">
                        <span className="pm-perf-bench-label">Benchmark</span>
                        <select
                            className="pm-sort-select"
                            value={benchKey}
                            onChange={(e) => setBenchKey(e.target.value)}
                        >
                            {benchmarks.map((b) => (
                                <option key={b.key} value={b.key}>
                                    {b.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </header>

            <AreaChart
                data={portfolioNormalized}
                benchmark={benchNormalized}
                range={range}
                height={260}
                ariaLabel={`Equity curve vs ${activeBench?.label ?? "benchmark"} over ${range}`}
            />

            <div className="pm-perf-readouts">
                <Readout
                    label="TWR"
                    value={fmtPct(readouts.twr)}
                    tone={signTone(readouts.twr)}
                />
                <Readout label="Bench" value={fmtPct(readouts.bench)} />
                <Readout
                    label="Alpha"
                    value={fmtPct(readouts.alpha)}
                    tone={signTone(readouts.alpha)}
                />
                <Readout label="Sharpe" value={fmtRatio(readouts.sharpe)} />
                <Readout label="Sortino" value={fmtRatio(readouts.sortino)} />
                <Readout label="Max DD" value={fmtPct(readouts.maxDd)} tone="neg" />
            </div>
        </section>
    );
}

function Readout({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: "pos" | "neg";
}) {
    return (
        <div className="pm-perf-readout">
            <span className="pm-perf-readout-label">{label}</span>
            <span
                className={`pm-perf-readout-val num${tone ? ` pm-num-${tone}` : ""}`}
            >
                {value}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeTo100(vals: readonly number[]): number[] {
    if (vals.length === 0) return [];
    const base = vals[0];
    if (!Number.isFinite(base) || base === 0) return vals.slice();
    return vals.map((v) => (v / base) * 100);
}

function fmtPct(x: number): string {
    if (!Number.isFinite(x)) return "0.00%";
    const pct = x * 100;
    const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
    return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

function fmtRatio(x: number): string {
    if (!Number.isFinite(x)) return "0.00";
    return x.toFixed(2);
}

function signTone(x: number): "pos" | "neg" | undefined {
    if (x > 0) return "pos";
    if (x < 0) return "neg";
    return undefined;
}

function wantedMonthsForPeriod(
    p: PeriodKey,
    series: readonly MonthlyValuation[],
): number {
    if (series.length === 0) return 0;
    const last = series[series.length - 1];
    switch (p) {
        case "1M":
            return 1;
        case "3M":
            return 3;
        case "6M":
            return 6;
        case "1Y":
            return 12;
        case "YTD":
            return last.month + 1;
        case "ALL":
        default:
            return series.length - 1;
    }
}
