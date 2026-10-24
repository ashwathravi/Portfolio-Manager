"use client";

import { dateAxisLabels } from "@/lib/charts";
import { useMemo, useState } from "react";
import { AreaChart, type AreaChartRange } from "@/components/charts";
import {
    computePeriodMetrics,
    computeRiskSnapshot,
    measuresRisk,
    sliceForPeriod,
    type DatedValue,
    type PeriodKey,
} from "@/lib/performance/periodSummary";

/**
 * Phase 4 (AR-75) Equity curve card.
 *
 * Renders the hero chart for the Performance page:
 *   - Time-range segmented control (1M / 3M / 6M / YTD / 1Y / 3Y / ALL);
 *     a range the history doesn't reach back to is disabled
 *   - Benchmark dropdown (the benchmarks passed in; none hides it)
 *   - Portfolio + benchmark lines normalized to 100 at period start so the
 *     comparison stays meaningful across benchmarks with different scales.
 *   - Readouts: TWR, benchmark and alpha in the hero; Sharpe, Sortino and
 *     Max DD along the bottom. All numbers come from `computePeriodMetrics`
 *     + `computeRiskSnapshot`, so the chart and cells are internally consistent.
 */

export type EquityRange = Extract<
    AreaChartRange,
    "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "ALL"
>;

export interface Benchmark {
    key: string;
    label: string;
    /** Values on the portfolio's dates. */
    series: DatedValue[];
}

export interface EquityCurveCardProps {
    portfolio: DatedValue[];
    benchmarks: Benchmark[];
    /** Observations per year: 12 for month ends, 252 for daily closes. */
    periodsPerYear: number;
}

const RANGES: readonly EquityRange[] = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "ALL"];
const EMPTY_BENCHMARK_SERIES: DatedValue[] = [];

export function EquityCurveCard({ portfolio, benchmarks, periodsPerYear }: EquityCurveCardProps) {
    const sorted = useMemo(
        () => [...portfolio].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
        [portfolio],
    );
    const covered = useMemo(
        () => new Set(RANGES.filter((r) => sliceForPeriod(sorted, r as PeriodKey).covered)),
        [sorted],
    );
    const [range, setRange] = useState<EquityRange>(() => (covered.has("1Y") ? "1Y" : "ALL"));
    const [benchKey, setBenchKey] = useState(benchmarks[0]?.key ?? "");

    const activeBench =
        benchmarks.find((b) => b.key === benchKey) ?? benchmarks[0] ?? null;
    const benchSeries = activeBench?.series ?? EMPTY_BENCHMARK_SERIES;

    const periodKey: PeriodKey = range;

    // Slice the portfolio for the selected period, and the benchmark to the
    // same dates, so the chart rescales independently of the readouts.
    const { slicePortfolio, sliceBench } = useMemo(() => {
        const { points } = sliceForPeriod(sorted, periodKey);
        const start = points[0]?.date ?? "";
        return {
            slicePortfolio: points,
            sliceBench: benchSeries.filter((b) => b.date >= start),
        };
    }, [sorted, benchSeries, periodKey]);

    // TWR / bench / alpha / sharpe / max DD for the period come from the
    // calculation engine. Sortino comes from the risk snapshot over the same
    // slice so it's consistent with the visible chart.
    const readouts = useMemo(() => {
        const [metric] = computePeriodMetrics(sorted, benchSeries, [periodKey], { periodsPerYear });
        const risk = computeRiskSnapshot(slicePortfolio, sliceBench, { periodsPerYear });
        return {
            twr: metric?.return ?? 0,
            bench: metric?.benchmark ?? null,
            alpha: metric?.alpha ?? null,
            start: metric?.start ?? null,
            sharpe: metric?.sharpe ?? null,
            sortino: measuresRisk(slicePortfolio) ? risk.sortinoRatio : null,
            maxDd: metric?.maxDrawdown ?? 0,
        };
    }, [sorted, benchSeries, slicePortfolio, sliceBench, periodKey, periodsPerYear]);

    const portfolioNormalized = normalizeTo100(slicePortfolio.map((p) => p.value));
    const benchNormalized = normalizeTo100(sliceBench.map((p) => p.value));
    const windowLabel = range === "ALL" && readouts.start ? `since ${fmtDate(readouts.start)}` : range;

    return (
        <section className="pm-card pm-card-stack pm-perf-equity-card">
            <header className="pm-perf-equity-head">
                <div>
                    <h2 className="pm-card-title">Equity curve</h2>
                    <p className="pm-perf-hero" data-testid="performance-hero">
                        <span className={`pm-perf-hero-twr ${signTone(readouts.twr) === "pos" ? "pm-pos" : signTone(readouts.twr) === "neg" ? "pm-neg" : ""}`}>
                            {fmtPct(readouts.twr)}
                        </span>
                        <span className="pm-perf-hero-sub">
                            time-weighted, {windowLabel}
                            {activeBench && readouts.bench !== null && readouts.alpha !== null
                                ? ` · ${activeBench.label} ${fmtPct(readouts.bench)} · alpha ${fmtPct(readouts.alpha)}`
                                : ""}
                        </span>
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
                                disabled={!covered.has(r) && r !== "ALL"}
                                title={!covered.has(r) && r !== "ALL" ? `Less than ${r} of history` : undefined}
                                onClick={() => setRange(r)}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                    {benchmarks.length > 0 && (
                        <label className="pm-perf-bench-select">
                            <span className="pm-perf-bench-label">Benchmark</span>
                            <select
                                className="pm-sort-select"
                                value={activeBench?.key ?? ""}
                                onChange={(e) => setBenchKey(e.target.value)}
                            >
                                {benchmarks.map((b) => (
                                    <option key={b.key} value={b.key}>
                                        {b.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>
            </header>

            <AreaChart
                data={portfolioNormalized}
                benchmark={benchNormalized.length === portfolioNormalized.length ? benchNormalized : undefined}
                range={range}
                xLabels={dateAxisLabels(slicePortfolio)}
                height={260}
                ariaLabel={`Equity curve${activeBench ? ` vs ${activeBench.label}` : ""} over ${windowLabel}`}
            />

            {/* TWR, benchmark, and alpha lead the card above; the strip keeps
                the risk figures. */}
            <div className="pm-perf-readouts">
                <Readout label="Sharpe" value={readouts.sharpe === null ? "—" : fmtRatio(readouts.sharpe)} />
                <Readout label="Sortino" value={readouts.sortino === null ? "—" : fmtRatio(readouts.sortino)} />
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

/** "Aug 31, 2026" for a YYYY-MM-DD date, the same on server and client. */
function fmtDate(date: string): string {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    });
}

function signTone(x: number): "pos" | "neg" | undefined {
    if (x > 0) return "pos";
    if (x < 0) return "neg";
    return undefined;
}
