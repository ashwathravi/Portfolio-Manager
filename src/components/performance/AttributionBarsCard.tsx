"use client";

import { useMemo, useState } from "react";
import { BarChart, type BarDatum } from "@/components/charts";
import {
    computeAttribution,
    type AttributionResult,
    type AttributionSegment,
} from "@/lib/performance/attribution";

/**
 * Phase 4 (AR-76) Attribution bars card.
 *
 * Renders a BarChart for a chosen attribution effect across either sector
 * segments or asset-class segments, with a totals strip underneath that
 * shows the roll-up alpha and its three components (allocation / selection
 * / interaction). The BHB math lives in `lib/performance/attribution.ts`;
 * this card is purely presentational.
 */

export type AttributionMode = "allocation" | "selection" | "interaction" | "total";
export type AttributionBasis = "sector" | "assetClass";

const MODE_LABELS: Record<AttributionMode, string> = {
    allocation: "Allocation effect",
    selection: "Selection effect",
    interaction: "Interaction",
    total: "Total effect",
};

const BASIS_LABELS: Record<AttributionBasis, string> = {
    sector: "Sector",
    assetClass: "Asset class",
};

export interface AttributionBarsCardProps {
    sectors: AttributionSegment[];
    assetClasses: AttributionSegment[];
}

function effectValue(r: AttributionResult, mode: AttributionMode): number {
    switch (mode) {
        case "allocation":
            return r.allocationEffect;
        case "selection":
            return r.selectionEffect;
        case "interaction":
            return r.interactionEffect;
        case "total":
            return r.totalEffect;
    }
}

export function AttributionBarsCard({
    sectors,
    assetClasses,
}: AttributionBarsCardProps) {
    const [basis, setBasis] = useState<AttributionBasis>("sector");
    const [mode, setMode] = useState<AttributionMode>("selection");

    const source = basis === "sector" ? sectors : assetClasses;
    const summary = useMemo(() => computeAttribution(source), [source]);

    // Express effects in percentage *points* so the BarChart labels read as
    // +2.1 / −0.8 rather than tiny 0.021 numbers.
    const bars: BarDatum[] = summary.segments.map((r) => ({
        label: shortLabel(r.label),
        value: effectValue(r, mode) * 100,
    }));

    return (
        <section className="pm-card pm-card-stack">
            <header className="pm-perf-attr-head">
                <div>
                    <h2 className="pm-card-title">Attribution</h2>
                    <p className="pm-card-subtitle">
                        BHB decomposition of excess return, by {BASIS_LABELS[basis].toLowerCase()}
                    </p>
                </div>
                <div className="pm-perf-attr-controls">
                    <div
                        role="radiogroup"
                        aria-label="Attribution basis"
                        className="pm-seg-pill"
                    >
                        {(["sector", "assetClass"] as const).map((b) => (
                            <button
                                key={b}
                                type="button"
                                role="radio"
                                aria-checked={basis === b}
                                className="pm-seg-pill-btn"
                                onClick={() => setBasis(b)}
                            >
                                {BASIS_LABELS[b]}
                            </button>
                        ))}
                    </div>
                    <select
                        className="pm-sort-select"
                        value={mode}
                        onChange={(e) => setMode(e.target.value as AttributionMode)}
                        aria-label="Effect"
                    >
                        {(Object.keys(MODE_LABELS) as AttributionMode[]).map((m) => (
                            <option key={m} value={m}>
                                {MODE_LABELS[m]}
                            </option>
                        ))}
                    </select>
                </div>
            </header>

            <BarChart
                data={bars}
                height={220}
                formatValue={fmtBarLabel}
                ariaLabel={`${MODE_LABELS[mode]} across ${BASIS_LABELS[basis].toLowerCase()} segments`}
            />

            <footer className="pm-perf-attr-totals">
                <TotalCell label="Alpha" value={summary.total.alpha} highlight />
                <TotalCell label="Allocation" value={summary.total.allocationEffect} />
                <TotalCell label="Selection" value={summary.total.selectionEffect} />
                <TotalCell label="Interaction" value={summary.total.interactionEffect} />
            </footer>
        </section>
    );
}

function TotalCell({
    label,
    value,
    highlight,
}: {
    label: string;
    value: number;
    highlight?: boolean;
}) {
    const pct = value * 100;
    const tone = pct > 0 ? "pm-num-pos" : pct < 0 ? "pm-num-neg" : "";
    const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
    return (
        <div
            className={`pm-perf-attr-total${highlight ? " pm-perf-attr-total-hi" : ""}`}
        >
            <span className="pm-perf-readout-label">{label}</span>
            <span className={`pm-perf-readout-val num ${tone}`}>
                {sign}
                {Math.abs(pct).toFixed(2)}%
            </span>
        </div>
    );
}

function fmtBarLabel(v: number): string {
    if (!Number.isFinite(v)) return "0.0";
    const sign = v > 0 ? "+" : v < 0 ? "−" : "";
    return `${sign}${Math.abs(v).toFixed(1)}`;
}

// "Communication Services" overflows the bar slot — trim a few common offenders.
function shortLabel(label: string): string {
    return label
        .replace(/International /, "Intl ")
        .replace(/Consumer Discretionary/, "Cons. Disc.")
        .replace(/Communication Services/, "Comms.")
        .replace(/Cash & Equivalents/, "Cash");
}
