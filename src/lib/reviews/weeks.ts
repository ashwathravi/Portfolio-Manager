/**
 * AR-114 — week-boundary math for the weekly review.
 *
 * Pure functions. Callers pass `now` so tests stay deterministic.
 * Everything is in local timezone; once live brokerage data carries
 * tz info we'll switch to US-Eastern. For the seed era the journal
 * records local timestamps so local is correct.
 */
import type { WeekBounds } from './types';

/**
 * Cutoff hour-of-day used to decide whether "this week" counts as
 * the still-live trading week or the most recent completed one. If
 * the current local time is past Friday 16:00, the review for this
 * week is ready. Before that, we show last week's review.
 */
const FRIDAY_CLOSE_HOUR = 16;

/** Monday of the week containing `date`, at 00:00 local. */
function mondayOf(date: Date): Date {
    const d = new Date(date);
    const js = d.getDay(); // 0=Sun..6=Sat
    // JS week starts Sunday; shift so Monday is index 0. Sunday
    // rolls back 6 days; Mon rolls back 0; Fri rolls back 4, etc.
    const offsetToMon = js === 0 ? 6 : js - 1;
    d.setDate(d.getDate() - offsetToMon);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** `YYYY-MM-DD` for a local date. Stable regardless of timezone
 *  because we only format the local Y/M/D — no tz conversion. */
function toLocalDateId(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** True if `date` is after the Friday 16:00 close of the week that
 *  contains it. Weekends always count as "past Friday close". */
function isPastFridayClose(date: Date): boolean {
    const js = date.getDay();
    if (js === 0 || js === 6) return true; // Sun/Sat
    if (js < 5) return false; // Mon..Thu
    // Friday: compare against 16:00 local.
    return date.getHours() >= FRIDAY_CLOSE_HOUR;
}

/**
 * Return the bounds of the most recently completed trading week —
 * i.e. the Monday/Friday pair whose Friday-close precedes `now`.
 * If the current local time is during an in-progress Mon-Fri
 * before Friday close, the returned bounds describe *last* week.
 */
export function currentWeekBounds(now: Date = new Date()): WeekBounds {
    const base = isPastFridayClose(now)
        ? new Date(now)
        : // Jump back 7 days to land in last week's Mon..Fri range.
          new Date(now.getTime() - 7 * 86_400_000);

    const mon = mondayOf(base);
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);
    fri.setHours(FRIDAY_CLOSE_HOUR, 0, 0, 0);

    const id = `wk:${toLocalDateId(mon)}`;
    return {
        id,
        weekStart: mon.toISOString(),
        weekEnd: fri.toISOString(),
    };
}

/**
 * Bounds for `n` weeks back from the most recently completed week.
 * `n = 0` is the same as `currentWeekBounds`. Handy for the archive.
 */
export function pastWeekBounds(n: number, now: Date = new Date()): WeekBounds {
    const cur = currentWeekBounds(now);
    const curMon = new Date(cur.weekStart);
    const mon = new Date(curMon);
    mon.setDate(curMon.getDate() - n * 7);
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);
    fri.setHours(FRIDAY_CLOSE_HOUR, 0, 0, 0);
    return {
        id: `wk:${toLocalDateId(mon)}`,
        weekStart: mon.toISOString(),
        weekEnd: fri.toISOString(),
    };
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

/** `Apr 14 – Apr 18` — abbreviated range suitable for card titles. */
export function formatWeekRange(bounds: WeekBounds): string {
    const start = new Date(bounds.weekStart);
    const end = new Date(bounds.weekEnd);
    const sameMonth = start.getMonth() === end.getMonth();
    const fmtMonth = (d: Date) =>
        d.toLocaleDateString('en-US', { month: 'short' });
    const fmtDay = (d: Date) => d.getDate();
    return sameMonth
        ? `${fmtMonth(start)} ${fmtDay(start)}–${fmtDay(end)}`
        : `${fmtMonth(start)} ${fmtDay(start)} – ${fmtMonth(end)} ${fmtDay(end)}`;
}
