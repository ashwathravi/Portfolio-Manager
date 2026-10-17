/**
 * NYSE market hours and trading calendar (AR-66, launch item i36)
 *
 * The sidebar card, the Today subtitle and the server jobs all ask the same
 * questions: is the market open right now, and which session closed last?
 * Regular hours are 9:30 AM – 4:00 PM ET on trading days, with a 1:00 PM
 * close on the three early-close days. Holidays follow NYSE Rule 7.2 and are
 * computed rather than listed, so the calendar never runs out; one-off
 * closures are listed. It covers 2018 onward, and the tests pin it to the
 * dates NYSE publishes.
 *
 * Every date here is an Eastern calendar date in `YYYY-MM-DD` form. Clock
 * readings go through `Intl.DateTimeFormat` in `America/New_York`, which
 * handles daylight saving, so results don't depend on the host's time zone.
 */

const NYSE_OPEN_MINUTES = 9 * 60 + 30; // 9:30 AM ET
const NYSE_CLOSE_MINUTES = 16 * 60; // 4:00 PM ET
const NYSE_EARLY_CLOSE_MINUTES = 13 * 60; // 1:00 PM ET

const ET_ZONE = "America/New_York";

/**
 * The calendar covers 2018 onward, the years its rules have been checked
 * against what NYSE actually did. Earlier years had exceptions the rules
 * don't capture (a 1:00 PM close on July 5, 2002; a noon opening on
 * September 11, 2002), so they are refused rather than answered wrongly.
 * Nothing needs prices that old: the free data tier keeps two years.
 */
export const FIRST_CALENDAR_YEAR = 2018;

/** Full-day closures NYSE announced outside Rule 7.2 since 2018. */
const SPECIAL_CLOSURES: Record<string, string> = {
    "2018-12-05": "National Day of Mourning for President George H. W. Bush",
    "2025-01-09": "National Day of Mourning for President Jimmy Carter",
};

interface EtParts {
    weekday: number; // 0 = Sun … 6 = Sat (JS convention)
    hour: number;
    minute: number;
    hour12Text: string; // e.g. "9:42 AM"
    date: string; // Eastern calendar date, YYYY-MM-DD
}

export interface MarketDay {
    date: string;
    isTradingDay: boolean;
    /** NYSE's name for the holiday when the market is closed for one. */
    holiday: string | null;
    /** True on the 1:00 PM ET early-close days. */
    earlyClose: boolean;
    /** Minutes after midnight ET when the regular session ends; null when closed. */
    closeMinutes: number | null;
}

export interface MarketHoliday {
    date: string;
    name: string;
}

// Built once: `Intl.DateTimeFormat` construction is the expensive part, and
// the sidebar clock calls `getEasternParts` every 30 seconds.
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: ET_ZONE, weekday: "short" });
const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
});
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: ET_ZONE, hour: "numeric", hour12: false });
const minuteFmt = new Intl.DateTimeFormat("en-US", { timeZone: ET_ZONE, minute: "numeric" });
const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

/**
 * Extracts ET weekday/hour/minute, the ET calendar date and a formatted clock
 * string from a JS Date. Runs in the browser and on the server without a
 * time-zone library.
 */
export function getEasternParts(now: Date = new Date()): EtParts {
    const weekday = WEEKDAY_MAP[weekdayFmt.format(now)] ?? 0;
    // `hour: 'numeric'` with `hour12: false` yields 0..23; on some locales it
    // yields "24" for midnight — normalize.
    const rawHour = Number(hourFmt.format(now));
    const hour = Number.isFinite(rawHour) ? rawHour % 24 : 0;
    const minute = Number(minuteFmt.format(now)) || 0;
    const hour12Text = timeFmt.format(now);

    const parts = Object.fromEntries(dateFmt.formatToParts(now).map((part) => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;

    return { weekday, hour, minute, hour12Text, date };
}

const WEEKDAY_MAP: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

/**
 * Returns true if NYSE is in its regular (non-extended-hours) session for
 * the given moment: a trading day, from 9:30 AM ET until that day's close.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
    const { hour, minute, date } = getEasternParts(now);
    const day = getMarketDay(date);
    if (day.closeMinutes === null) return false;
    const minutes = hour * 60 + minute;
    return minutes >= NYSE_OPEN_MINUTES && minutes < day.closeMinutes;
}

/**
 * Returns a compact "9:42 AM ET" label suitable for the sidebar market
 * card. Using `America/New_York` rather than the viewer's system tz
 * is deliberate — the intent is to show the *market's* clock, not theirs.
 */
export function formatEtClock(now: Date = new Date()): string {
    const { hour12Text } = getEasternParts(now);
    return `${hour12Text} ET`;
}

/**
 * Human label for the market state shown in page subtitles. Uses
 * {@link isMarketOpen} so the dashboard and the sidebar card can never
 * disagree.
 */
export function marketStateLabel(now: Date = new Date()): "Markets open" | "Markets closed" {
    return isMarketOpen(now) ? "Markets open" : "Markets closed";
}

/** Whether NYSE trades on an Eastern calendar date, and until when. */
export function getMarketDay(date: string): MarketDay {
    const { year, weekday } = parseDate(date);
    const holiday = holidaysFor(year).get(date) ?? null;
    if (weekday === 0 || weekday === 6 || holiday) {
        return { date, isTradingDay: false, holiday, earlyClose: false, closeMinutes: null };
    }
    const earlyClose = earlyClosesFor(year).has(date);
    return {
        date,
        isTradingDay: true,
        holiday: null,
        earlyClose,
        closeMinutes: earlyClose ? NYSE_EARLY_CLOSE_MINUTES : NYSE_CLOSE_MINUTES,
    };
}

/** The trading day before `date` (exclusive). */
export function previousTradingDay(date: string): string {
    let cursor = addDays(date, -1);
    while (!getMarketDay(cursor).isTradingDay) cursor = addDays(cursor, -1);
    return cursor;
}

/** The trading day after `date` (exclusive). */
export function nextTradingDay(date: string): string {
    let cursor = addDays(date, 1);
    while (!getMarketDay(cursor).isTradingDay) cursor = addDays(cursor, 1);
    return cursor;
}

/**
 * The most recent trading day whose regular session has ended by `now`:
 * the date whose closing prices are final. Today once the bell has rung,
 * otherwise the trading day before.
 */
export function lastCompletedSession(now: Date = new Date()): string {
    const { hour, minute, date } = getEasternParts(now);
    const today = getMarketDay(date);
    if (today.closeMinutes !== null && hour * 60 + minute >= today.closeMinutes) return date;
    return previousTradingDay(date);
}

/**
 * The instant an Eastern wall-clock time occurs: `minutes` after midnight ET
 * on `date`, e.g. a session's close from {@link MarketDay.closeMinutes}.
 * Works out whether EST or EDT applies on that date, so 4:00 PM is 20:00 UTC
 * in July and 21:00 UTC in December. A time the spring-forward gap skips
 * (2:00–2:59 AM on that Sunday) has no instant and is refused.
 */
export function easternDateTime(date: string, minutes: number): Date {
    const { utc } = parseDate(date);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
        throw new RangeError(`Expected whole minutes within a day (0–1439), got ${minutes}`);
    }
    // Read the wall clock as if it were UTC, then try EDT (UTC-4) and EST
    // (UTC-5): the offset whose instant shows that clock in New York is right.
    const wallClockAsUtc = utc.getTime() + minutes * 60_000;
    for (const offsetHours of [4, 5]) {
        const candidate = new Date(wallClockAsUtc + offsetHours * 3_600_000);
        const parts = getEasternParts(candidate);
        if (parts.date === date && parts.hour * 60 + parts.minute === minutes) return candidate;
    }
    throw new RangeError(`${date} has no ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} in New York`);
}

/** NYSE full-day closures in `year`, in date order. */
export function marketHolidays(year: number): MarketHoliday[] {
    return [...holidaysFor(year)]
        .map(([date, name]) => ({ date, name }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

/** NYSE 1:00 PM ET early closes in `year`, in date order. */
export function marketEarlyCloses(year: number): string[] {
    return [...earlyClosesFor(year)].sort();
}

// --- Calendar rules --------------------------------------------------------

const holidayCache = new Map<number, Map<string, string>>();
const earlyCloseCache = new Map<number, Set<string>>();

function holidaysFor(year: number): Map<string, string> {
    const cached = holidayCache.get(year);
    if (cached) return cached;
    assertCalendarYear(year);

    const days = new Map<string, string>();
    // A Saturday New Year's Day is not moved to Friday: that Friday closes
    // the year (Rule 7.2's accounting-period exception), so it trades.
    const newYear = isoDate(year, 1, 1);
    if (parseDate(newYear).weekday !== 6) days.set(observed(newYear), "New Year's Day");
    days.set(nthWeekday(year, 1, 1, 3), "Martin Luther King, Jr. Day");
    days.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
    days.set(addDays(easterSunday(year), -2), "Good Friday");
    days.set(lastWeekday(year, 5, 1), "Memorial Day");
    if (year >= 2022) days.set(observed(isoDate(year, 6, 19)), "Juneteenth National Independence Day");
    days.set(observed(isoDate(year, 7, 4)), "Independence Day");
    days.set(nthWeekday(year, 9, 1, 1), "Labor Day");
    days.set(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
    days.set(observed(isoDate(year, 12, 25)), "Christmas Day");
    for (const [date, name] of Object.entries(SPECIAL_CLOSURES)) {
        if (date.startsWith(`${year}-`)) days.set(date, name);
    }

    holidayCache.set(year, days);
    return days;
}

function earlyClosesFor(year: number): Set<string> {
    const cached = earlyCloseCache.get(year);
    if (cached) return cached;
    assertCalendarYear(year);

    const days = new Set<string>();
    // July 3 and December 24 close early only when they fall Monday–Thursday;
    // on a Friday they are the observed holiday, and on a weekend nothing moves.
    for (const date of [isoDate(year, 7, 3), isoDate(year, 12, 24)]) {
        const { weekday } = parseDate(date);
        if (weekday >= 1 && weekday <= 4) days.add(date);
    }
    days.add(addDays(nthWeekday(year, 11, 4, 4), 1)); // the day after Thanksgiving

    earlyCloseCache.set(year, days);
    return days;
}

function assertCalendarYear(year: number): void {
    if (!Number.isInteger(year) || year < FIRST_CALENDAR_YEAR) {
        throw new RangeError(`The market calendar starts in ${FIRST_CALENDAR_YEAR}; got ${year}`);
    }
}

/** Rule 7.2: a Saturday holiday closes the Friday before, a Sunday one the Monday after. */
function observed(date: string): string {
    const { weekday } = parseDate(date);
    if (weekday === 6) return addDays(date, -1);
    if (weekday === 0) return addDays(date, 1);
    return date;
}

/** The nth `weekday` (0 = Sun) of a month, e.g. the third Monday of January. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
    const first = parseDate(isoDate(year, month, 1)).weekday;
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return isoDate(year, month, day);
}

/** The last `weekday` (0 = Sun) of a month, e.g. the last Monday of May. */
function lastWeekday(year: number, month: number, weekday: number): string {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = parseDate(isoDate(year, month, lastDay)).weekday;
    return isoDate(year, month, lastDay - ((last - weekday + 7) % 7));
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easterSunday(year: number): string {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return isoDate(year, month, day);
}

// --- Date helpers (calendar dates, computed in UTC so no zone can shift them) ---

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(date: string): { year: number; weekday: number; utc: Date } {
    const match = ISO_DATE.exec(date);
    const utc = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    if (!match || !utc || utc.toISOString().slice(0, 10) !== date) {
        throw new RangeError(`Expected a calendar date as YYYY-MM-DD, got "${date}"`);
    }
    const year = Number(match[1]);
    if (year < FIRST_CALENDAR_YEAR) {
        throw new RangeError(`The market calendar starts in ${FIRST_CALENDAR_YEAR}; got "${date}"`);
    }
    return { year, weekday: utc.getUTCDay(), utc };
}

function isoDate(year: number, month: number, day: number): string {
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
    const { utc } = parseDate(date);
    utc.setUTCDate(utc.getUTCDate() + days);
    return utc.toISOString().slice(0, 10);
}
