/**
 * AR-114 — week-boundary math for the weekly review.
 *
 * Pure functions. Callers pass `now` so tests stay deterministic.
 *
 * A review week is a calendar week in New York, Monday 00:00 ET up to the
 * next Monday 00:00 ET, whatever the browser's time zone: weeks meet, so
 * every trade (a Friday evening's or a weekend's included) is in exactly
 * one. Its review is ready once the week's last session has closed, from
 * the NYSE calendar (src/lib/markets/market-hours.ts): Friday 4:00 PM ET
 * most weeks, Thursday's close when Friday is a holiday, 1:00 PM on the day
 * after Thanksgiving (x23).
 */
import { easternDateTime, getEasternParts, getMarketDay } from '@/lib/markets/market-hours';
import type { WeekBounds } from './types';

const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` date as midnight UTC, so no time zone can shift it. */
function utcDay(date: string): Date {
    return new Date(`${date}T00:00:00Z`);
}

/** The calendar date `days` after `date` (before, when negative). */
function shiftDate(date: string, days: number): string {
    return new Date(utcDay(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of the Monday–Sunday week containing `date`. */
function mondayOf(date: string): string {
    const weekday = utcDay(date).getUTCDay(); // 0 = Sun … 6 = Sat
    return shiftDate(date, -(weekday === 0 ? 6 : weekday - 1));
}

/**
 * When the last session of the week starting `monday` closes. A week
 * without one (NYSE has had none since the calendar starts) has nothing to
 * wait for: it is ready from its Monday.
 */
function weekCloses(monday: string): Date {
    for (let day = 4; day >= 0; day--) {
        const date = shiftDate(monday, day);
        const { closeMinutes } = getMarketDay(date);
        if (closeMinutes !== null) return easternDateTime(date, closeMinutes);
    }
    return easternDateTime(monday, 0);
}

/** The week starting on `monday`, an Eastern date. */
function boundsFrom(monday: string): WeekBounds {
    return {
        id: `wk:${monday}`,
        weekStart: easternDateTime(monday, 0).toISOString(),
        weekEnd: easternDateTime(shiftDate(monday, 7), 0).toISOString(),
        closesAt: weekCloses(monday).toISOString(),
        firstDay: monday,
        lastDay: shiftDate(monday, 6),
    };
}

/**
 * The most recent week whose last session has closed by `now`: this week
 * from its last close on (the weekend included), the week before until
 * then.
 */
export function currentWeekBounds(now: Date = new Date()): WeekBounds {
    const thisWeek = boundsFrom(mondayOf(getEasternParts(now).date));
    return now.getTime() >= Date.parse(thisWeek.closesAt)
        ? thisWeek
        : boundsFrom(shiftDate(thisWeek.firstDay, -7));
}

/**
 * Bounds for `n` weeks back from the most recently completed week.
 * `n = 0` is the same as `currentWeekBounds`. Handy for the archive.
 */
export function pastWeekBounds(n: number, now: Date = new Date()): WeekBounds {
    return boundsFrom(shiftDate(currentWeekBounds(now).firstDay, -7 * n));
}

/**
 * Generate `count` consecutive week bounds, newest first. Default 8
 * is what the Performance archive card uses today.
 */
export function listRecentWeeks(count: number = 8, now: Date = new Date()): WeekBounds[] {
    const out: WeekBounds[] = [];
    for (let i = 0; i < count; i++) {
        out.push(pastWeekBounds(i, now));
    }
    return out;
}

/**
 * `Apr 14–18`, or `Mar 30 – Apr 3` across a month: the week's Monday to
 * Friday, for card titles. The same in every time zone.
 */
export function formatWeekRange(bounds: WeekBounds): string {
    const start = utcDay(bounds.firstDay);
    const end = utcDay(shiftDate(bounds.firstDay, 4));
    const fmtMonth = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    return start.getUTCMonth() === end.getUTCMonth()
        ? `${fmtMonth(start)} ${start.getUTCDate()}–${end.getUTCDate()}`
        : `${fmtMonth(start)} ${start.getUTCDate()} – ${fmtMonth(end)} ${end.getUTCDate()}`;
}
