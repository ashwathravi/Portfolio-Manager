"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { JournalEntry } from "@/types/trade";
import {
    buildYearCalendar,
    calendarScale,
    intensity,
    summarizeCalendar,
    yearsWithTrades,
    type DailyPnlCell,
} from "@/lib/analytics/dailyPnl";
import { SampleTag } from "@/components/data-display/SampleTag";

/**
 * Performance › Behaviour trading calendar.
 *
 * One continuous year grid (53 week columns × 7 days) of realized P&L by
 * close date, with a single metric strip above it. Replaces the retired
 * /analytics page, which split the year into twelve disconnected month
 * blocks, repeated its KPI set twice, and showed hardcoded totals.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function usd(n: number, signed = true): string {
    const sign = signed ? (n > 0 ? "+" : n < 0 ? "−" : "") : "";
    return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function shortDate(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export interface TradingCalendarCardProps {
    trades: JournalEntry[];
    /** True when `trades` are example fixtures rather than the user's history. */
    isSample?: boolean;
}

export function TradingCalendarCard({ trades, isSample = false }: TradingCalendarCardProps) {
    const years = useMemo(() => yearsWithTrades(trades), [trades]);
    const [year, setYear] = useState<number>(() => years[0] ?? new Date().getUTCFullYear());
    const weeks = useMemo(() => buildYearCalendar(trades, year), [trades, year]);
    const summary = useMemo(() => summarizeCalendar(weeks), [weeks]);
    const scale = useMemo(() => calendarScale(weeks), [weeks]);

    // Month label sits above the first week column that contains the 1st.
    const monthStarts = useMemo(() => {
        const out: { col: number; label: string }[] = [];
        weeks.forEach((week, col) => {
            const first = week.find((c) => c.inYear && c.date.endsWith("-01"));
            if (first) out.push({ col, label: MONTHS[Number(first.date.slice(5, 7)) - 1] });
        });
        return out;
    }, [weeks]);

    const minYear = years.length ? years[years.length - 1] : year;
    const maxYear = years.length ? years[0] : year;

    return (
        <section className="pm-card pm-card-stack pm-cal-card" data-testid="trading-calendar" aria-labelledby="pm-cal-head">
            <header className="pm-cal-head">
                <div>
                    <h2 id="pm-cal-head" className="pm-card-title">
                        Trading calendar {isSample && <SampleTag />}
                    </h2>
                    <p className="pm-card-subtitle">Realized P&amp;L by the day each trade closed</p>
                </div>
                <div className="pm-cal-year" role="group" aria-label="Year">
                    <button
                        type="button"
                        className="pm-icon-btn"
                        onClick={() => setYear((y) => y - 1)}
                        disabled={year <= minYear}
                        aria-label="Previous year"
                    >
                        <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <span className="pm-cal-year-label" data-testid="trading-calendar-year">{year}</span>
                    <button
                        type="button"
                        className="pm-icon-btn"
                        onClick={() => setYear((y) => y + 1)}
                        disabled={year >= maxYear}
                        aria-label="Next year"
                    >
                        <ChevronRight size={16} aria-hidden="true" />
                    </button>
                </div>
            </header>

            <dl className="pm-metric-strip" data-testid="trading-calendar-summary">
                <div>
                    <dt>Realized P&amp;L</dt>
                    <dd className={summary.totalPnl > 0 ? "is-pos" : summary.totalPnl < 0 ? "is-neg" : undefined}>
                        {usd(summary.totalPnl)}
                    </dd>
                </div>
                <div>
                    <dt>Trading days</dt>
                    <dd>{summary.tradingDays}</dd>
                </div>
                <div>
                    <dt>Winning days</dt>
                    <dd>{summary.winRatePct === null ? "—" : `${summary.winRatePct}%`}</dd>
                </div>
                {summary.bestDay && (
                    <div>
                        <dt>Best day</dt>
                        <dd className="is-pos">
                            {usd(summary.bestDay.pnl)} <span className="pm-metric-note">{shortDate(summary.bestDay.date)}</span>
                        </dd>
                    </div>
                )}
                {summary.worstDay && (
                    <div>
                        <dt>Worst day</dt>
                        <dd className="is-neg">
                            {usd(summary.worstDay.pnl)} <span className="pm-metric-note">{shortDate(summary.worstDay.date)}</span>
                        </dd>
                    </div>
                )}
            </dl>

            {summary.tradingDays === 0 ? (
                <p className="pm-empty-line">No closed trades in {year}.</p>
            ) : (
                <div className="pm-cal-scroll">
                    <div
                        className="pm-cal-grid"
                        style={{ gridTemplateColumns: `28px repeat(${weeks.length}, var(--pm-cal-cell))` }}
                        role="grid"
                        aria-label={`Daily realized P&L for ${year}`}
                    >
                        <span className="pm-cal-corner" aria-hidden="true" />
                        {weeks.map((_, col) => {
                            const label = monthStarts.find((m) => m.col === col)?.label;
                            return (
                                <span key={`m-${col}`} className="pm-cal-month" aria-hidden="true">
                                    {label ?? ""}
                                </span>
                            );
                        })}
                        {WEEKDAY_LABELS.map((dayLabel, row) => (
                            <CalendarRow key={row} label={dayLabel} row={row} weeks={weeks} scale={scale} />
                        ))}
                    </div>
                </div>
            )}

            <div className="pm-cal-legend" aria-hidden="true">
                <span>Loss</span>
                {[-3, -2, -1, 0, 1, 2, 3].map((level) => (
                    <span key={level} className="pm-cal-cell" data-level={level} />
                ))}
                <span>Gain</span>
            </div>
        </section>
    );
}

function CalendarRow({ label, row, weeks, scale }: { label: string; row: number; weeks: DailyPnlCell[][]; scale: number }) {
    return (
        <>
            <span className="pm-cal-weekday" aria-hidden="true">{label}</span>
            {weeks.map((week) => {
                const cell = week[row];
                if (!cell.inYear) return <span key={cell.date} className="pm-cal-cell is-pad" aria-hidden="true" />;
                const level = intensity(cell.pnl, cell.trades, scale);
                const text = cell.trades === 0
                    ? `${shortDate(cell.date)}: no trades`
                    : `${shortDate(cell.date)}: ${usd(cell.pnl)} across ${cell.trades} trade${cell.trades === 1 ? "" : "s"}`;
                return (
                    <span
                        key={cell.date}
                        role="gridcell"
                        className="pm-cal-cell"
                        data-level={level}
                        data-date={cell.date}
                        title={text}
                        aria-label={text}
                    />
                );
            })}
        </>
    );
}
