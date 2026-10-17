import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isTodaysQuote } from "./quote-session";

const close = (timestamp: string) => ({ timestamp, isRealtime: false, change: 1.5, changePercent: 0.6 });

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
        assert.equal(isTodaysQuote({ ...close("2026-10-01T15:00:00Z"), isRealtime: true }, new Date("2026-10-16T15:00:00Z")), true);
        assert.equal(isTodaysQuote(close("not a date"), new Date("2026-10-16T15:00:00Z")), false);
    });

    test("a quote with no earlier close to compare with has no move, even from today's session", () => {
        // A newly tracked symbol's first stored close.
        const first = { ...close("2026-10-16T20:00:00.000Z"), change: null, changePercent: null };
        assert.equal(isTodaysQuote(first, "2026-10-16"), false);
        assert.equal(isTodaysQuote({ ...first, isRealtime: true }, "2026-10-16"), false);
        assert.equal(isTodaysQuote({ ...close("2026-10-16T20:00:00.000Z"), changePercent: Number.NaN }, "2026-10-16"), false);
    });

    test("narrows the change to a number", () => {
        const quote: { timestamp: string; isRealtime: boolean; change: number | null; changePercent: number | null } = close("2026-10-16T20:00:00.000Z");
        if (isTodaysQuote(quote, "2026-10-16")) {
            const percent: number = quote.changePercent;
            assert.equal(percent, 0.6);
        } else {
            assert.fail("expected today's move");
        }
    });
});
