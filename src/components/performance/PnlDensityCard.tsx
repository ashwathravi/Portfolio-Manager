"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { JournalEntry } from "@/types/trade";
import {
    buildHeatmap,
    colorFor,
    computeCallouts,
    computeScale,
    dayLabel,
    hourLabel,
    totalTrades,
    usd,
    type HeatCell,
} from "@/lib/analytics/heatmap";

/**
 * AR-113 P&L density card — 6 weekdays × 24 hours, each cell tinted
 * by the average realised P&L of trades that closed in that window.
 *
 * This is the "when do I trade well?" lens. A working PM stares at
 * this and goes "oh, Friday afternoons hate me" — so the callout
 * names the best and worst windows in plain language. Deterministic,
 * no AI in the loop. The detector math lives in `lib/analytics/heatmap`
 * so a v2 pass can wire live trade data without touching the view.
 *
 * Interaction:
 *   - hover any cell    → tooltip with day, hour, trade count, net P&L
 *   - range selector    → 30d / 90d / 1Y / ALL (same labels as mood card)
 *   - no data in range  → empty state instead of a grid of grey boxes
 */

type RangeKey = "30d" | "90d" | "1y" | "all";

const RANGES: ReadonlyArray<{ key: RangeKey; label: string; days: number | null }> = [
    { key: "30d", label: "30d", days: 30 },
    { key: "90d", label: "90d", days: 90 },
    { key: "1y", label: "1Y", days: 365 },
    { key: "all", label: "ALL", days: null },
];

// Legend swatches, top→bottom, aligned with `colorFor` thresholds.
const LEGEND_SWATCHES: ReadonlyArray<{ color: string; label: string }> = [
    { color: "#17cf54", label: "Big gain" },
    { color: "#bbf7d0", label: "Gain" },
    { color: "#f0f2f4", label: "Neutral" },
    { color: "#fee2e2", label: "Loss" },
    { color: "#fecaca", label: "Big loss" },
];

export interface PnlDensityCardProps {
    trades: JournalEntry[];
    /** Test seam — freezes the "now" used for range filtering.
     *  Omit in real use; defaults to `Date.now()`. */
    now?: number;
}

export function PnlDensityCard({ trades, now }: PnlDensityCardProps) {
    const [rangeKey, setRangeKey] = useState<RangeKey>("90d");
    const [hovered, setHovered] = useState<HeatCell | null>(null);
    const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];

    const { cells, scale, callouts, total } = useMemo(() => {
        const cells = buildHeatmap(trades, range.days, now);
        return {
            cells,
            scale: computeScale(cells),
            callouts: computeCallouts(cells),
            total: totalTrades(cells),
        };
    }, [trades, range.days, now]);

    const isEmpty = total === 0;

    return (
        <section
            className="pm-card pm-card-stack pm-heat-card"
            data-testid="pnl-density-card"
            aria-labelledby="pm-heat-head"
        >
            <header className="pm-heat-head">
                <div>
                    <h2 id="pm-heat-head" className="pm-card-title">
                        P&amp;L density · weekday × hour
                    </h2>
                    <p className="pm-card-subtitle">
                        Realised P&amp;L of closed trades, binned by weekday and hour (local time)
                    </p>
                </div>
                <div
                    className="pm-heat-range"
                    role="tablist"
                    aria-label="Time range"
                >
                    {RANGES.map((r) => (
                        <button
                            key={r.key}
                            role="tab"
                            type="button"
                            className="pm-heat-range-btn"
                            aria-selected={r.key === rangeKey}
                            data-active={r.key === rangeKey ? "true" : "false"}
                            data-testid={`pnl-density-range-${r.key}`}
                            onClick={() => setRangeKey(r.key)}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </header>

            {isEmpty ? (
                <div className="pm-heat-empty" data-testid="pnl-density-empty">
                    <p>No executions in this range.</p>
                    <p className="pm-heat-empty-sub">
                        Close a few trades or widen the window to see the heatmap light up.
                    </p>
                </div>
            ) : (
                <>
                    <div className="pm-heat-wrap">
                        <HeatGrid
                            cells={cells}
                            scale={scale}
                            onHover={setHovered}
                        />
                        <HeatLegend />
                    </div>

                    <Callouts
                        callouts={callouts}
                        total={total}
                        rangeLabel={range.label}
                    />
                </>
            )}

            {hovered && (
                <div
                    className="pm-heat-tooltip"
                    role="status"
                    aria-live="polite"
                    data-testid="pnl-density-tooltip"
                >
                    <strong>
                        {dayLabel(hovered.day)} {hourLabel(hovered.hour)}
                    </strong>
                    {" · "}
                    {hovered.trades} {hovered.trades === 1 ? "trade" : "trades"}
                    {hovered.trades > 0 && (
                        <>
                            {" · "}
                            <span
                                className="pm-heat-tooltip-pnl"
                                data-sign={
                                    hovered.totalPnl > 0
                                        ? "pos"
                                        : hovered.totalPnl < 0
                                          ? "neg"
                                          : "neutral"
                                }
                            >
                                {hovered.totalPnl > 0 ? "+" : ""}
                                {usd(hovered.totalPnl)} net
                            </span>
                        </>
                    )}
                </div>
            )}
        </section>
    );
}

// --------------------------------------------------------------------- //
// Grid
// --------------------------------------------------------------------- //

interface HeatGridProps {
    cells: HeatCell[];
    scale: number;
    onHover: (cell: HeatCell | null) => void;
}

function HeatGrid({ cells, scale, onHover }: HeatGridProps) {
    // Split cells by row (Mon=0..Sat=5). We rely on the `buildHeatmap`
    // contract that always returns 144 cells in day-major order.
    const rows: HeatCell[][] = [];
    for (let d = 0; d < 6; d++) {
        rows.push(cells.slice(d * 24, (d + 1) * 24));
    }
    const HOURS = Array.from({ length: 24 }, (_, h) => h);

    return (
        <div className="pm-heat-grid-wrap" role="group" aria-label="P&L density grid">
            <div
                className="pm-heat-grid"
                style={{ "--pm-heat-cols": 24 } as CSSProperties}
                data-testid="pnl-density-grid"
            >
                {/* top-left corner is empty — column headers start at col 2 */}
                <div className="pm-heat-corner" aria-hidden="true" />
                {HOURS.map((h) => (
                    <div key={`hh-${h}`} className="pm-heat-hour-head">
                        {h % 2 === 0 ? String(h).padStart(2, "0") : ""}
                    </div>
                ))}
                {rows.map((row, d) => (
                    <RowSlice
                        key={`row-${d}`}
                        day={d}
                        row={row}
                        scale={scale}
                        onHover={onHover}
                    />
                ))}
            </div>
        </div>
    );
}

interface RowSliceProps {
    day: number;
    row: HeatCell[];
    scale: number;
    onHover: (cell: HeatCell | null) => void;
}

function RowSlice({ day, row, scale, onHover }: RowSliceProps) {
    return (
        <>
            <div className="pm-heat-day-head">{dayLabel(day)}</div>
            {row.map((cell) => (
                <button
                    key={`${cell.day}-${cell.hour}`}
                    type="button"
                    className="pm-heat-cell"
                    style={{ backgroundColor: colorFor(cell.avgPnl, scale) }}
                    data-day={cell.day}
                    data-hour={cell.hour}
                    data-trades={cell.trades}
                    data-testid={`pnl-density-cell-${cell.day}-${cell.hour}`}
                    aria-label={`${dayLabel(cell.day)} ${hourLabel(cell.hour)}, ${
                        cell.trades
                    } ${cell.trades === 1 ? "trade" : "trades"}, net ${
                        cell.trades > 0 ? usd(cell.totalPnl) : "no data"
                    }`}
                    onMouseEnter={() => onHover(cell)}
                    onFocus={() => onHover(cell)}
                    onMouseLeave={() => onHover(null)}
                    onBlur={() => onHover(null)}
                />
            ))}
        </>
    );
}

// --------------------------------------------------------------------- //
// Legend
// --------------------------------------------------------------------- //

function HeatLegend() {
    return (
        <aside
            className="pm-heat-legend"
            aria-label="Heatmap colour scale"
            data-testid="pnl-density-legend"
        >
            <p className="pm-heat-legend-title">Scale</p>
            <ul className="pm-heat-legend-list" role="list">
                {LEGEND_SWATCHES.map((s) => (
                    <li key={s.label} className="pm-heat-legend-row">
                        <span
                            className="pm-heat-legend-swatch"
                            style={{ backgroundColor: s.color }}
                            aria-hidden="true"
                        />
                        <span className="pm-heat-legend-label">{s.label}</span>
                    </li>
                ))}
            </ul>
            <p className="pm-heat-legend-note">
                Based on average trade P&amp;L per cell; neutral shown when
                no trades closed in that window.
            </p>
        </aside>
    );
}

// --------------------------------------------------------------------- //
// Callouts — plain-language best / worst summary
// --------------------------------------------------------------------- //

interface CalloutsProps {
    callouts: ReturnType<typeof computeCallouts>;
    total: number;
    rangeLabel: string;
}

function Callouts({ callouts, total, rangeLabel }: CalloutsProps) {
    const { best, worst } = callouts;
    if (!best && !worst) return null;

    return (
        <div className="pm-heat-callouts" data-testid="pnl-density-callouts">
            {best && (
                <p
                    className="pm-heat-callout pm-heat-callout-pos"
                    data-testid="pnl-density-callout-best"
                >
                    <span className="pm-heat-callout-dot pm-heat-callout-dot-pos" />
                    <span>
                        <strong>
                            {dayLabel(best.day)} {hourLabel(best.hour)}
                        </strong>{" "}
                        accounts for{" "}
                        <strong>{Math.round(best.sharePct)}%</strong> of your
                        realised P&amp;L in the {rangeLabel === "ALL" ? "full history" : `last ${rangeLabel}`}{" "}
                        ({best.trades} {best.trades === 1 ? "trade" : "trades"},{" "}
                        {usd(best.totalPnl)}).
                    </span>
                </p>
            )}
            {worst && (
                <p
                    className="pm-heat-callout pm-heat-callout-neg"
                    data-testid="pnl-density-callout-worst"
                >
                    <span className="pm-heat-callout-dot pm-heat-callout-dot-neg" />
                    <span>
                        <strong>
                            {dayLabel(worst.day)} {hourLabel(worst.hour)}
                        </strong>{" "}
                        is consistently negative ({usd(worst.totalPnl)},{" "}
                        {worst.trades} {worst.trades === 1 ? "trade" : "trades"}).
                    </span>
                </p>
            )}
            <p className="pm-heat-callouts-note">
                Analysis over <strong>{total}</strong>{" "}
                {total === 1 ? "closed trade" : "closed trades"} in range.
            </p>
        </div>
    );
}
