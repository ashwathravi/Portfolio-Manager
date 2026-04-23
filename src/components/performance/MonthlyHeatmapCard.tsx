"use client";

import { useMemo, type CSSProperties } from "react";
import type { MonthlyValuation } from "@/lib/performance/periodSummary";

/**
 * Phase 4 (AR-77) Monthly return heatmap.
 *
 * Year × 12-month grid of month-over-month returns, plus a rightmost "YR"
 * column that chain-links the year's monthly returns into a single number.
 * Intensity scales with `|ret| / maxAbs` so the hottest and coldest months
 * pop while middling ones fade. Green for positive, red for negative —
 * both use the existing `--pm-success` / `--pm-danger` tokens via
 * `color-mix(in oklab, … X%, transparent)` for theme-safe tints.
 */

const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

// 0.12 .. 0.82 tint range, matching the Phase 4 spec in the design doc.
const TINT_MIN = 0.12;
const TINT_MAX = 0.82;

export interface MonthlyHeatmapCardProps {
    portfolio: MonthlyValuation[];
}

interface ComputedHeatmap {
    years: number[];
    byYear: Map<number, Array<number | null>>;
    yearTotals: Map<number, number>;
    maxAbs: number;
}

export function MonthlyHeatmapCard({ portfolio }: MonthlyHeatmapCardProps) {
    const { years, byYear, yearTotals, maxAbs } = useMemo<ComputedHeatmap>(() => {
        const sorted = [...portfolio].sort((a, b) =>
            a.year === b.year ? a.month - b.month : a.year - b.year,
        );
        const byYear = new Map<number, Array<number | null>>();
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1].value;
            const curr = sorted[i];
            const ret = prev === 0 ? 0 : (curr.value - prev) / prev;
            if (!byYear.has(curr.year)) {
                byYear.set(curr.year, new Array<number | null>(12).fill(null));
            }
            const row = byYear.get(curr.year);
            if (row) row[curr.month] = ret;
        }
        const years = Array.from(byYear.keys()).sort((a, b) => a - b);
        const yearTotals = new Map<number, number>();
        for (const y of years) {
            const row = byYear.get(y) ?? [];
            let growth = 1;
            for (const r of row) {
                if (r != null && Number.isFinite(r)) growth *= 1 + r;
            }
            yearTotals.set(y, growth - 1);
        }
        const allRets: number[] = [];
        for (const row of byYear.values()) {
            for (const r of row) {
                if (r != null && Number.isFinite(r)) allRets.push(Math.abs(r));
            }
        }
        const maxAbs = allRets.length > 0 ? Math.max(...allRets) : 0.0001;
        return { years, byYear, yearTotals, maxAbs };
    }, [portfolio]);

    return (
        <section className="pm-card pm-card-stack">
            <header>
                <h2 className="pm-card-title">Monthly return heatmap</h2>
                <p className="pm-card-subtitle">
                    Month-over-month TWR, intensity scales with magnitude
                </p>
            </header>
            <div className="pm-heatmap-wrap">
                <table className="pm-heatmap">
                    <thead>
                        <tr>
                            <th scope="col" aria-label="Year" />
                            {MONTHS.map((m) => (
                                <th key={m} scope="col">
                                    {m}
                                </th>
                            ))}
                            <th scope="col" className="pm-heatmap-yr-col">
                                YR
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {years.map((y) => {
                            const row = byYear.get(y) ?? [];
                            const yrTotal = yearTotals.get(y) ?? 0;
                            return (
                                <tr key={y}>
                                    <th scope="row">{y}</th>
                                    {row.map((ret, m) => (
                                        <td
                                            key={m}
                                            className="pm-heatmap-cell"
                                            style={cellStyle(ret, maxAbs)}
                                            title={
                                                ret == null
                                                    ? `${MONTHS[m]} ${y}: no data`
                                                    : `${MONTHS[m]} ${y}: ${fmtLongPct(ret)}`
                                            }
                                        >
                                            {ret == null ? "" : fmtShortPct(ret)}
                                        </td>
                                    ))}
                                    <td
                                        className="pm-heatmap-cell pm-heatmap-yr-col"
                                        style={yrStyle(yrTotal)}
                                        title={`${y} YTD: ${fmtLongPct(yrTotal)}`}
                                    >
                                        {fmtShortPct(yrTotal)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function cellStyle(ret: number | null, maxAbs: number): CSSProperties {
    if (ret == null || !Number.isFinite(ret)) {
        return { background: "transparent", color: "var(--pm-fg-subtle)" };
    }
    const ratio = maxAbs === 0 ? 0 : Math.min(1, Math.abs(ret) / maxAbs);
    const tint = TINT_MIN + ratio * (TINT_MAX - TINT_MIN); // 0.12..0.82
    const pct = Math.round(tint * 100);
    const base = ret >= 0 ? "var(--pm-success)" : "var(--pm-danger)";
    return {
        background: `color-mix(in oklab, ${base} ${pct}%, transparent)`,
    };
}

function yrStyle(ret: number): CSSProperties {
    if (!Number.isFinite(ret) || ret === 0) {
        return { fontWeight: 600 };
    }
    const base = ret >= 0 ? "var(--pm-success)" : "var(--pm-danger)";
    return {
        background: `color-mix(in oklab, ${base} 22%, transparent)`,
        fontWeight: 600,
    };
}

function fmtShortPct(x: number): string {
    if (!Number.isFinite(x) || x === 0) return "0.0";
    const pct = x * 100;
    const sign = pct > 0 ? "+" : "−";
    return `${sign}${Math.abs(pct).toFixed(1)}`;
}

function fmtLongPct(x: number): string {
    if (!Number.isFinite(x)) return "0.00%";
    const pct = x * 100;
    const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
    return `${sign}${Math.abs(pct).toFixed(2)}%`;
}
