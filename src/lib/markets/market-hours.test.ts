import { describe, test } from "node:test";
import assert from "node:assert";

import { isMarketOpen, formatEtClock, getEasternParts } from "./market-hours";

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
