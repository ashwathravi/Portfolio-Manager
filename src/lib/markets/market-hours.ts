/**
 * NYSE regular-session market-hours helper (AR-66)
 *
 * The sidebar market card has to tell the user whether the market is open
 * right now, alongside the current Eastern-time clock. A full holiday
 * calendar would be overkill for a marketing badge — we approximate with
 * the 9:30 AM – 4:00 PM ET Mon–Fri window and surface a thin API so
 * callers can swap in a more accurate provider later without touching
 * UI code.
 *
 * NB: this intentionally *doesn't* account for NYSE holidays (e.g.
 * Thanksgiving early close) or daylight-saving transitions in the
 * borrower's locale — it always formats in the `America/New_York` zone
 * via `Intl.DateTimeFormat`, which does handle DST correctly.
 */

const NYSE_OPEN_MINUTES = 9 * 60 + 30; // 9:30 AM ET
const NYSE_CLOSE_MINUTES = 16 * 60; // 4:00 PM ET

interface EtParts {
    weekday: number; // 0 = Sun … 6 = Sat (JS convention)
    hour: number;
    minute: number;
    hour12Text: string; // e.g. "9:42 AM"
}

/**
 * Extracts ET weekday/hour/minute + a formatted clock string from a JS Date.
 * Runs in the browser (no heavy tz lib required) using `Intl.DateTimeFormat`
 * with the `America/New_York` time zone.
 */
export function getEasternParts(now: Date = new Date()): EtParts {
    // Use the short-weekday form to get Mon/Tue/… then map to a number. This
    // is the shape supported by all evergreen browsers and Node 20+.
    const weekdayFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
    });
    const timeFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
    const hourFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
    });
    const minuteFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        minute: "numeric",
    });

    const weekdayText = weekdayFmt.format(now);
    const weekday = WEEKDAY_MAP[weekdayText] ?? 0;
    // `hour: 'numeric'` with `hour12: false` yields 0..23; on some locales it
    // yields "24" for midnight — normalize.
    const rawHour = Number(hourFmt.format(now));
    const hour = Number.isFinite(rawHour) ? rawHour % 24 : 0;
    const minute = Number(minuteFmt.format(now)) || 0;
    const hour12Text = timeFmt.format(now);

    return { weekday, hour, minute, hour12Text };
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
 * Returns true if NYSE is in its regular (non-holiday, non-extended-hours)
 * session for the given moment. Exported for the sidebar live-dot and for
 * tests.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
    const { weekday, hour, minute } = getEasternParts(now);
    // Weekends are always closed.
    if (weekday === 0 || weekday === 6) return false;
    const minutes = hour * 60 + minute;
    return minutes >= NYSE_OPEN_MINUTES && minutes < NYSE_CLOSE_MINUTES;
}

/**
 * Returns a compact "9:42 AM ET" label suitable for the sidebar market
 * card. Using `America/New_York` rather than the borrower's system tz
 * is deliberate — the intent is to show the *market's* clock, not theirs.
 */
export function formatEtClock(now: Date = new Date()): string {
    const { hour12Text } = getEasternParts(now);
    return `${hour12Text} ET`;
}
