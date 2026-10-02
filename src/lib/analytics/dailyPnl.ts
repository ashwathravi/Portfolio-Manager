import type { JournalEntry } from '@/types/trade';

/**
 * Daily realized P&L calendar — the data behind Performance › Behaviour's
 * trading calendar. Replaces the hardcoded month blocks that used to live
 * on /analytics with one continuous year grid derived from closed trades.
 *
 * Dates are bucketed in UTC so the grid is stable regardless of the
 * viewer's timezone (and identical between server and client renders).
 */

export interface DailyPnlCell {
    /** ISO date, `YYYY-MM-DD`. */
    date: string;
    /** 0 = Sunday … 6 = Saturday. */
    weekday: number;
    /** Net realized P&L for trades that closed this day. */
    pnl: number;
    trades: number;
    /** False for padding cells before Jan 1 / after Dec 31. */
    inYear: boolean;
}

export interface DailyPnlSummary {
    totalPnl: number;
    trades: number;
    tradingDays: number;
    /** Share of trading days with positive P&L, 0–100. Null with no trading days. */
    winRatePct: number | null;
    bestDay: DailyPnlCell | null;
    /** Only set when at least one day closed at a loss. */
    worstDay: DailyPnlCell | null;
}

const DAY_MS = 86_400_000;

function isoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/** Groups closed trades by UTC close date. */
export function dailyTotals(entries: readonly Pick<JournalEntry, 'closedAt' | 'realizedPnlUsd'>[]): Map<string, { pnl: number; trades: number }> {
    const out = new Map<string, { pnl: number; trades: number }>();
    for (const e of entries) {
        const t = Date.parse(e.closedAt);
        if (!Number.isFinite(t)) continue;
        const key = isoDate(t);
        const prev = out.get(key) ?? { pnl: 0, trades: 0 };
        prev.pnl = Math.round((prev.pnl + e.realizedPnlUsd) * 100) / 100;
        prev.trades += 1;
        out.set(key, prev);
    }
    return out;
}

/**
 * Builds the calendar as week columns (Sunday-first), padded so every
 * column has seven cells. Jan 1 lands in the first column on its weekday.
 */
export function buildYearCalendar(
    entries: readonly Pick<JournalEntry, 'closedAt' | 'realizedPnlUsd'>[],
    year: number,
): DailyPnlCell[][] {
    const totals = dailyTotals(entries);
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    const firstWeekday = new Date(start).getUTCDay();
    const gridStart = start - firstWeekday * DAY_MS;

    const weeks: DailyPnlCell[][] = [];
    for (let weekStart = gridStart; weekStart < end; weekStart += 7 * DAY_MS) {
        const week: DailyPnlCell[] = [];
        for (let d = 0; d < 7; d++) {
            const ms = weekStart + d * DAY_MS;
            const date = isoDate(ms);
            const inYear = ms >= start && ms < end;
            const total = inYear ? totals.get(date) : undefined;
            week.push({ date, weekday: d, pnl: total?.pnl ?? 0, trades: total?.trades ?? 0, inYear });
        }
        weeks.push(week);
    }
    return weeks;
}

export function summarizeCalendar(weeks: readonly DailyPnlCell[][]): DailyPnlSummary {
    let totalPnl = 0;
    let trades = 0;
    let tradingDays = 0;
    let winners = 0;
    let bestDay: DailyPnlCell | null = null;
    let worstDay: DailyPnlCell | null = null;
    for (const week of weeks) {
        for (const cell of week) {
            if (!cell.inYear || cell.trades === 0) continue;
            tradingDays += 1;
            trades += cell.trades;
            totalPnl += cell.pnl;
            if (cell.pnl > 0) winners += 1;
            if (!bestDay || cell.pnl > bestDay.pnl) bestDay = cell;
            if (cell.pnl < 0 && (!worstDay || cell.pnl < worstDay.pnl)) worstDay = cell;
        }
    }
    return {
        totalPnl: Math.round(totalPnl * 100) / 100,
        trades,
        tradingDays,
        winRatePct: tradingDays === 0 ? null : Math.round((winners / tradingDays) * 1000) / 10,
        bestDay: bestDay && bestDay.pnl > 0 ? bestDay : null,
        worstDay,
    };
}

/** Intensity bucket for a cell: 0 = no trades, ±1..±3 by size relative to `scale`. */
export function intensity(pnl: number, trades: number, scale: number): -3 | -2 | -1 | 0 | 1 | 2 | 3 {
    if (trades === 0 || pnl === 0 || scale <= 0) return 0;
    const ratio = Math.min(1, Math.abs(pnl) / scale);
    const step = ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : 1;
    return (pnl > 0 ? step : -step) as 1 | 2 | 3 | -1 | -2 | -3;
}

/** Largest absolute daily P&L in the grid — the scale for `intensity`. */
export function calendarScale(weeks: readonly DailyPnlCell[][]): number {
    let max = 0;
    for (const week of weeks) for (const cell of week) if (cell.inYear) max = Math.max(max, Math.abs(cell.pnl));
    return max;
}

/** Years that contain at least one closed trade, newest first. */
export function yearsWithTrades(entries: readonly Pick<JournalEntry, 'closedAt'>[]): number[] {
    const years = new Set<number>();
    for (const e of entries) {
        const t = Date.parse(e.closedAt);
        if (Number.isFinite(t)) years.add(new Date(t).getUTCFullYear());
    }
    return [...years].sort((a, b) => b - a);
}
