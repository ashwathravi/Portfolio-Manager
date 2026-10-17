import { describe, test } from "node:test";
import assert from "node:assert";

import {
    formatEtClock,
    getEasternParts,
    getMarketDay,
    isMarketOpen,
    lastCompletedSession,
    marketEarlyCloses,
    marketHolidays,
    marketStateLabel,
    nextTradingDay,
    previousTradingDay,
} from "./market-hours";

/**
 * Market-hours helper behavior. We construct UTC Dates at known instants
 * that land on specific ET clock positions so the tests don't depend on
 * the host machine's tz. `getEasternParts` delegates to `Intl.DateTimeFormat`
 * with `timeZone: 'America/New_York'`, so these assertions work in any
 * runner timezone.
 *
 * ET cheatsheet (during EDT = UTC-4, summer):
 *   09:30 ET = 13:30 UTC
 *   16:00 ET = 20:00 UTC
 *
 * ET cheatsheet (during EST = UTC-5, winter):
 *   09:30 ET = 14:30 UTC
 *   16:00 ET = 21:00 UTC
 */
describe("market-hours", () => {
    describe("isMarketOpen", () => {
        test("Monday 10:00 AM ET (EDT summer) — open", () => {
            // Mon 2025-06-02 14:00 UTC = Mon 10:00 AM EDT
            assert.strictEqual(
                isMarketOpen(new Date("2025-06-02T14:00:00.000Z")),
                true
            );
        });

        test("Monday 9:29 AM ET — closed (one minute before open)", () => {
            // Mon 2025-06-02 13:29 UTC = Mon 9:29 AM EDT
            assert.strictEqual(
                isMarketOpen(new Date("2025-06-02T13:29:00.000Z")),
                false
            );
        });

        test("Monday 4:00 PM ET — closed (exactly at close)", () => {
            // Mon 2025-06-02 20:00 UTC = Mon 4:00 PM EDT
            // Market closes AT 4:00 PM — the tick at exactly 16:00 should
            // already read as closed for the user.
            assert.strictEqual(
                isMarketOpen(new Date("2025-06-02T20:00:00.000Z")),
                false
            );
        });

        test("Monday 3:59 PM ET — open (one minute before close)", () => {
            // Mon 2025-06-02 19:59 UTC = Mon 3:59 PM EDT
            assert.strictEqual(
                isMarketOpen(new Date("2025-06-02T19:59:00.000Z")),
                true
            );
        });

        test("Saturday 10:00 AM ET — closed (weekend)", () => {
            // Sat 2025-06-07 14:00 UTC = Sat 10:00 AM EDT
            assert.strictEqual(
                isMarketOpen(new Date("2025-06-07T14:00:00.000Z")),
                false
            );
        });

        test("Sunday 10:00 AM ET — closed (weekend)", () => {
            // Sun 2025-06-08 14:00 UTC = Sun 10:00 AM EDT
            assert.strictEqual(
                isMarketOpen(new Date("2025-06-08T14:00:00.000Z")),
                false
            );
        });

        test("EST winter: Monday 9:30 AM ET — open", () => {
            // Mon 2025-01-06 14:30 UTC = Mon 9:30 AM EST
            assert.strictEqual(
                isMarketOpen(new Date("2025-01-06T14:30:00.000Z")),
                true
            );
        });
    });

    describe("getEasternParts", () => {
        test("returns Mon-weekday 1 for a Monday", () => {
            const parts = getEasternParts(new Date("2025-06-02T14:00:00.000Z"));
            assert.strictEqual(parts.weekday, 1);
        });

        test("returns Sat-weekday 6 for a Saturday", () => {
            const parts = getEasternParts(new Date("2025-06-07T14:00:00.000Z"));
            assert.strictEqual(parts.weekday, 6);
        });

        test("returns 10 for 10:00 AM ET", () => {
            const parts = getEasternParts(new Date("2025-06-02T14:00:00.000Z"));
            assert.strictEqual(parts.hour, 10);
            assert.strictEqual(parts.minute, 0);
        });
    });

    describe("formatEtClock", () => {
        test("renders 10:00 AM ET label", () => {
            assert.strictEqual(
                formatEtClock(new Date("2025-06-02T14:00:00.000Z")),
                "10:00 AM ET"
            );
        });

        test("renders 3:45 PM ET label", () => {
            // Mon 2025-06-02 19:45 UTC = Mon 3:45 PM EDT
            assert.strictEqual(
                formatEtClock(new Date("2025-06-02T19:45:00.000Z")),
                "3:45 PM ET"
            );
        });
    });
});

describe("marketStateLabel", () => {
    test("Monday 10:00 AM EDT reads 'Markets open'", () => {
        assert.strictEqual(marketStateLabel(new Date("2026-06-15T14:00:00Z")), "Markets open");
    });

    test("regression: Wednesday 1:56 AM ET reads 'Markets closed', matching the sidebar", () => {
        const now = new Date("2026-09-30T05:56:00Z");
        assert.strictEqual(isMarketOpen(now), false);
        assert.strictEqual(marketStateLabel(now), "Markets closed");
    });

    test("Saturday midday reads 'Markets closed'", () => {
        assert.strictEqual(marketStateLabel(new Date("2026-06-13T16:00:00Z")), "Markets closed");
    });
});

// Published NYSE calendars: the 2024 release (2025) and the Dec 23, 2025
// release "NYSE Group Announces 2026, 2027 and 2028 Holiday and Early
// Closings Calendar".
const NYSE_HOLIDAYS: Record<number, string[]> = {
    2025: ["2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"],
    2026: ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"],
    2027: ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"],
    2028: ["2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25"],
};

const NYSE_EARLY_CLOSES: Record<number, string[]> = {
    2025: ["2025-07-03", "2025-11-28", "2025-12-24"],
    2026: ["2026-11-27", "2026-12-24"],
    2027: ["2027-11-26"],
    2028: ["2028-07-03", "2028-11-24"],
};

describe("NYSE trading calendar", () => {
    for (const [year, dates] of Object.entries(NYSE_HOLIDAYS)) {
        test(`${year} holidays match the published NYSE calendar`, () => {
            assert.deepStrictEqual(marketHolidays(Number(year)).map((h) => h.date), dates);
        });
    }

    for (const [year, dates] of Object.entries(NYSE_EARLY_CLOSES)) {
        test(`${year} early closes match the published NYSE calendar`, () => {
            assert.deepStrictEqual(marketEarlyCloses(Number(year)), dates);
        });
    }

    test("a Saturday New Year's Day is not observed on the Friday before", () => {
        // Jan 1, 2028 is a Saturday; Friday Dec 31, 2027 trades.
        assert.strictEqual(getMarketDay("2027-12-31").isTradingDay, true);
        assert.strictEqual(marketHolidays(2028).some((h) => h.name === "New Year's Day"), false);
    });

    test("Juneteenth is a market holiday only from 2022", () => {
        assert.strictEqual(getMarketDay("2021-06-18").isTradingDay, true);
        assert.strictEqual(getMarketDay("2022-06-20").holiday, "Juneteenth National Independence Day");
    });

    test("names holidays and observed days the way NYSE does", () => {
        assert.deepStrictEqual(getMarketDay("2026-07-03"), {
            date: "2026-07-03",
            isTradingDay: false,
            holiday: "Independence Day",
            earlyClose: false,
            closeMinutes: null,
        });
        assert.strictEqual(getMarketDay("2026-04-03").holiday, "Good Friday");
    });

    test("weekends are closed without a holiday name", () => {
        assert.deepStrictEqual(getMarketDay("2026-10-17"), {
            date: "2026-10-17",
            isTradingDay: false,
            holiday: null,
            earlyClose: false,
            closeMinutes: null,
        });
    });

    test("early-close days end at 1:00 PM ET, other trading days at 4:00 PM", () => {
        assert.strictEqual(getMarketDay("2026-11-27").closeMinutes, 13 * 60);
        assert.strictEqual(getMarketDay("2026-11-27").earlyClose, true);
        assert.strictEqual(getMarketDay("2026-11-30").closeMinutes, 16 * 60);
    });

    test("rejects malformed and impossible dates", () => {
        assert.throws(() => getMarketDay("2026-2-3"), RangeError);
        assert.throws(() => getMarketDay("2026-02-30"), RangeError);
    });

    test("refuses years before the calendar starts instead of guessing", () => {
        // NYSE first closed for Martin Luther King, Jr. Day in 1998.
        assert.throws(() => getMarketDay("1997-01-20"), RangeError);
        assert.throws(() => marketHolidays(1999), RangeError);
        assert.throws(() => previousTradingDay("2000-01-03"), RangeError);
        assert.strictEqual(getMarketDay("2000-01-03").isTradingDay, true);
    });

    test("knows the one-off closures since 2000", () => {
        for (const date of ["2001-09-11", "2001-09-14", "2004-06-11", "2007-01-02", "2012-10-29", "2012-10-30", "2018-12-05"]) {
            assert.strictEqual(getMarketDay(date).isTradingDay, false, date);
        }
        assert.strictEqual(getMarketDay("2018-12-05").holiday, "National Day of Mourning for President George H. W. Bush");
        assert.strictEqual(previousTradingDay("2018-12-06"), "2018-12-04");
        assert.strictEqual(nextTradingDay("2001-09-10"), "2001-09-17");
    });

    test("previous and next trading days skip weekends and holidays", () => {
        assert.strictEqual(previousTradingDay("2026-09-08"), "2026-09-04"); // over Labor Day weekend
        assert.strictEqual(nextTradingDay("2026-12-24"), "2026-12-28"); // over Christmas
        assert.strictEqual(nextTradingDay("2027-12-23"), "2027-12-27"); // Christmas observed Friday Dec 24
        assert.strictEqual(previousTradingDay("2027-01-04"), "2026-12-31"); // New Year's Day on Friday
    });
});

describe("isMarketOpen with the calendar", () => {
    test("closed all day on Thanksgiving", () => {
        // Thu 2026-11-26 15:00 UTC = 10:00 AM EST
        assert.strictEqual(isMarketOpen(new Date("2026-11-26T15:00:00Z")), false);
        assert.strictEqual(marketStateLabel(new Date("2026-11-26T15:00:00Z")), "Markets closed");
    });

    test("closed on an observed holiday", () => {
        // Fri 2026-07-03 14:00 UTC = 10:00 AM EDT, Independence Day observed
        assert.strictEqual(isMarketOpen(new Date("2026-07-03T14:00:00Z")), false);
    });

    test("closes at 1:00 PM ET the day after Thanksgiving", () => {
        // Fri 2026-11-27: 17:59 UTC = 12:59 PM EST, 18:00 UTC = 1:00 PM EST
        assert.strictEqual(isMarketOpen(new Date("2026-11-27T17:59:00Z")), true);
        assert.strictEqual(isMarketOpen(new Date("2026-11-27T18:00:00Z")), false);
    });

    test("uses the Eastern date, not UTC, near midnight", () => {
        // 2026-11-27 03:00 UTC is still Thanksgiving (10:00 PM EST Nov 26).
        assert.strictEqual(getEasternParts(new Date("2026-11-27T03:00:00Z")).date, "2026-11-26");
    });
});

describe("lastCompletedSession", () => {
    test("is the previous trading day before today's close", () => {
        // Tue 2026-09-08 19:00 UTC = 3:00 PM EDT; Monday was Labor Day.
        assert.strictEqual(lastCompletedSession(new Date("2026-09-08T19:00:00Z")), "2026-09-04");
    });

    test("is today once the closing bell has rung", () => {
        // Tue 2026-09-08 20:05 UTC = 4:05 PM EDT
        assert.strictEqual(lastCompletedSession(new Date("2026-09-08T20:05:00Z")), "2026-09-08");
    });

    test("respects an early close", () => {
        // Fri 2026-11-27 18:30 UTC = 1:30 PM EST, after the 1:00 PM close
        assert.strictEqual(lastCompletedSession(new Date("2026-11-27T18:30:00Z")), "2026-11-27");
    });

    test("on a holiday is the trading day before", () => {
        // Thanksgiving 2026, mid-afternoon
        assert.strictEqual(lastCompletedSession(new Date("2026-11-26T21:00:00Z")), "2026-11-25");
    });
});
