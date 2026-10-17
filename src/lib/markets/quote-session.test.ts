import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isTodaysQuote } from "./quote-session";

const close = (timestamp: string) => ({ timestamp, isRealtime: false });

describe("isTodaysQuote", () => {
    test("a close from today's session is today's move", () => {
        // Fri 2026-10-16 4:00 PM EDT close, read at 6:00 PM EDT the same day
        assert.equal(isTodaysQuote(close("2026-10-16T20:00:00.000Z"), new Date("2026-10-16T22:00:00Z")), true);
    });

    test("during the next session, yesterday's close is not today's move", () => {
        // Thu close, read Fri 11:00 AM EDT
        assert.equal(isTodaysQuote(close("2026-10-15T20:00:00.000Z"), new Date("2026-10-16T15:00:00Z")), false);
    });

    test("uses the Eastern date, not UTC, late in the evening", () => {
        // Fri close read at 9:30 PM EDT, which is already Saturday in UTC
        assert.equal(isTodaysQuote(close("2026-10-16T20:00:00.000Z"), new Date("2026-10-17T01:30:00Z")), true);
    });

    test("on a weekend, Friday's close is not today's move", () => {
        assert.equal(isTodaysQuote(close("2026-10-16T20:00:00.000Z"), new Date("2026-10-17T15:00:00Z")), false);
    });

    test("accepts today's Eastern date as a string", () => {
        assert.equal(isTodaysQuote(close("2026-10-16T20:00:00.000Z"), "2026-10-16"), true);
        assert.equal(isTodaysQuote(close("2026-10-16T20:00:00.000Z"), "2026-10-17"), false);
    });

    test("a live quote is always today's, and a bad timestamp never is", () => {
        assert.equal(isTodaysQuote({ timestamp: "2026-10-01T15:00:00Z", isRealtime: true }, new Date("2026-10-16T15:00:00Z")), true);
        assert.equal(isTodaysQuote(close("not a date"), new Date("2026-10-16T15:00:00Z")), false);
    });
});
