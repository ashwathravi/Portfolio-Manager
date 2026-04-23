"use client";

import { useMemo, useState } from "react";
import { AreaChart, type AreaChartRange } from "@/components/charts";

/**
 * Phase 3 (AR-71) equity-curve chart card.
 *
 * Layout (top → bottom):
 *   - Header row: title + range segmented control (1D / 1W / 1M / 1Y / ALL).
 *   - 4-readout row: Period Δ$, Period Δ%, Alpha, Max DD.
 *   - AreaChart with the portfolio curve + S&P benchmark.
 *
 * Until we wire historical portfolio series from the database, the curve
 * data is deterministically generated from `netWorth` + `seed`. The spec
 * says "range seg changes data immediately" — we satisfy that by resampling
 * the walk per range pick so the click always produces a visible redraw.
 */

const RANGES: AreaChartRange[] = ["1D", "1W", "1M", "1Y", "ALL"];

export interface EquityChartCardProps {
    /** Current portfolio net worth — anchors the end of the curve. */
    netWorth: number;
    /**
     * Seed used to keep the random walk stable across renders. Typically
     * something portfolio-specific (e.g. count of holdings).
     */
    seed?: number;
    className?: string;
}

export function EquityChartCard({
    netWorth,
    seed = 1,
    className,
}: EquityChartCardProps) {
    const [range, setRange] = useState<AreaChartRange>("1M");

    const { portfolio, benchmark, readouts } = useMemo(
        () => buildSeries(netWorth, range, seed),
        [netWorth, range, seed],
    );

    return (
        <section
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            aria-label="Equity curve"
        >
            <header className="pm-card-header">
                <div>
                    <h3 className="pm-card-title">Equity Curve</h3>
                    <p className="pm-card-subtitle">
                        Portfolio vs. S&amp;P 500 benchmark
                    </p>
                </div>
                <RangeSeg range={range} onChange={setRange} />
            </header>

            <div className="pm-readout-row">
                <Readout label={`${range} Δ$`} value={readouts.changeDollar} positive={readouts.positive} />
                <Readout label={`${range} Δ%`} value={readouts.changePercent} positive={readouts.positive} />
                <Readout label="Alpha" value={readouts.alpha} positive={readouts.alphaPositive} />
                <Readout label="Max DD" value={readouts.maxDD} positive={false} />
            </div>

            <AreaChart
                data={portfolio}
                benchmark={benchmark}
                range={range}
                ariaLabel={`Portfolio equity curve, ${range}`}
                height={240}
            />
        </section>
    );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function RangeSeg({
    range,
    onChange,
}: {
    range: AreaChartRange;
    onChange: (r: AreaChartRange) => void;
}) {
    return (
        <div className="pm-seg-pill" role="radiogroup" aria-label="Time range">
            {RANGES.map((r) => (
                <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={r === range}
                    className="pm-seg-pill-btn"
                    onClick={() => onChange(r)}
                >
                    {r}
                </button>
            ))}
        </div>
    );
}

function Readout({
    label,
    value,
    positive,
}: {
    label: string;
    value: string;
    positive?: boolean;
}) {
    const cls =
        positive === true
            ? "pm-readout-value pm-readout-value-pos"
            : positive === false
              ? "pm-readout-value pm-readout-value-neg"
              : "pm-readout-value";
    return (
        <div className="pm-readout">
            <span className="pm-readout-label">{label}</span>
            <span className={cls}>{value}</span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Series generation (deterministic pseudo-random walk, anchored to netWorth)
// ---------------------------------------------------------------------------

interface Readouts {
    changeDollar: string;
    changePercent: string;
    alpha: string;
    maxDD: string;
    positive: boolean;
    alphaPositive: boolean;
}

interface SeriesBundle {
    portfolio: number[];
    benchmark: number[];
    readouts: Readouts;
}

/**
 * Rough point counts per range. Tuned so the curve has enough detail to
 * read without punishing render cost on wider ranges.
 */
const POINTS_PER_RANGE: Record<AreaChartRange, number> = {
    "1D": 78,   // 5-minute bars through the session
    "1W": 35,   // ~7 * 5 intraday
    "1M": 22,   // trading days
    "3M": 63,
    "6M": 126,
    YTD: 100,
    "1Y": 52,   // weeks
    "3Y": 156,
    ALL: 120,
};

/**
 * Typical period drift & vol so the curve "feels right" for each range.
 */
const DRIFT_VOL_PER_RANGE: Record<AreaChartRange, { drift: number; vol: number }> = {
    "1D": { drift: 0.004, vol: 0.004 },
    "1W": { drift: 0.012, vol: 0.010 },
    "1M": { drift: 0.028, vol: 0.016 },
    "3M": { drift: 0.060, vol: 0.022 },
    "6M": { drift: 0.11, vol: 0.025 },
    YTD: { drift: 0.09, vol: 0.028 },
    "1Y": { drift: 0.15, vol: 0.030 },
    "3Y": { drift: 0.40, vol: 0.040 },
    ALL: { drift: 0.80, vol: 0.050 },
};

function buildSeries(netWorth: number, range: AreaChartRange, seed: number): SeriesBundle {
    const points = POINTS_PER_RANGE[range];
    const { drift, vol } = DRIFT_VOL_PER_RANGE[range];
    const end = Math.max(netWorth, 1000);
    const start = end / (1 + drift);

    const rand = mulberry32(hashSeed(seed, range));
    const portfolio: number[] = new Array(points);
    let x = start;
    for (let i = 0; i < points; i++) {
        const t = i / (points - 1 || 1);
        const trend = start + (end - start) * t;
        const noise = (rand() - 0.5) * 2 * vol * end;
        x = trend + noise;
        portfolio[i] = x;
    }
    // Anchor the last point exactly so "Current" readouts match the value.
    portfolio[points - 1] = end;

    // Benchmark trails by a random fraction between 0 and drift (so Alpha
    // is usually positive but sometimes negative).
    const benchEnd = start * (1 + drift * (0.3 + rand() * 0.9));
    const benchmark: number[] = new Array(points);
    for (let i = 0; i < points; i++) {
        const t = i / (points - 1 || 1);
        const trend = start + (benchEnd - start) * t;
        const noise = (rand() - 0.5) * 2 * vol * 0.8 * end;
        benchmark[i] = trend + noise;
    }
    benchmark[points - 1] = benchEnd;

    const changeDollar = end - start;
    const changePercent = (changeDollar / start) * 100;
    const alpha = ((end - start) / start - (benchEnd - start) / start) * 100;
    const maxDD = computeMaxDrawdown(portfolio);

    return {
        portfolio,
        benchmark,
        readouts: {
            changeDollar: formatSignedCurrency(changeDollar),
            changePercent: formatSignedPercent(changePercent),
            alpha: `${alpha >= 0 ? "+" : "−"}${Math.abs(alpha).toFixed(2)} pp`,
            maxDD: `${maxDD.toFixed(2)}%`,
            positive: changeDollar >= 0,
            alphaPositive: alpha >= 0,
        },
    };
}

function computeMaxDrawdown(series: number[]): number {
    let peak = series[0] ?? 0;
    let maxDD = 0;
    for (const v of series) {
        if (v > peak) peak = v;
        const dd = peak > 0 ? (v - peak) / peak : 0;
        if (dd < maxDD) maxDD = dd;
    }
    return maxDD * 100;
}

function formatSignedCurrency(n: number): string {
    const sign = n >= 0 ? "+" : "−";
    return `${sign}$${Math.abs(n).toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    })}`;
}
function formatSignedPercent(n: number): string {
    const sign = n >= 0 ? "+" : "−";
    return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function hashSeed(seed: number, range: AreaChartRange): number {
    let h = seed | 0;
    for (const ch of range) {
        h = (h * 31 + ch.charCodeAt(0)) | 0;
    }
    return h || 1;
}

function mulberry32(a: number): () => number {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
