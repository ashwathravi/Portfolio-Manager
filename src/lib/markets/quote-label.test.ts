import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { describeQuote, describeQuotes, formatSessionDate } from "./quote-label";

const MONDAY = "2026-11-02";
const delayed = (timestamp: string) => ({ kind: "delayed" as const, timestamp });
const close = (timestamp: string) => ({ kind: "close" as const, timestamp });

describe("describeQuote", () => {
    test("a delayed quote says so, with its Eastern time", () => {
        assert.equal(describeQuote(delayed("2026-11-02T15:42:10Z"), MONDAY), "Delayed quote, 10:42 AM ET");
        // Seen after midnight ET, it also names the day.
        assert.equal(describeQuote(delayed("2026-11-02T20:59:00Z"), "2026-11-03"), "Delayed quote, Nov 2 3:59 PM ET");
    });

    test("a close says which session's", () => {
        assert.equal(describeQuote(close("2026-11-02T21:00:00Z"), MONDAY), "Today's close");
        assert.equal(describeQuote(close("2026-10-30T20:00:00Z"), MONDAY), "Last close, Oct 30");
        assert.equal(describeQuote(close("2025-12-31T21:00:00Z"), MONDAY), "Last close, Dec 31, 2025");
    });

    test("never calls a price live, even without a readable time", () => {
        assert.equal(describeQuote(delayed("soon"), MONDAY), "Delayed quote");
        assert.equal(describeQuote(close(""), MONDAY), "Last close");
    });
});

describe("describeQuotes", () => {
    test("delayed quotes are as old as the oldest of them", () => {
        assert.equal(
            describeQuotes([delayed("2026-11-02T15:42:00Z"), delayed("2026-11-02T15:38:00Z")], MONDAY),
            "Delayed quotes, as of 10:38 AM ET",
        );
    });

    test("closes name their session", () => {
        assert.equal(describeQuotes([close("2026-10-30T20:00:00Z"), close("2026-10-30T20:00:00Z")], MONDAY), "Closing prices from Oct 30");
        assert.equal(describeQuotes([close("2026-11-02T21:00:00Z")], MONDAY), "Closing prices from today");
        assert.equal(
            describeQuotes([close("2026-10-28T20:00:00Z"), close("2026-10-30T20:00:00Z")], MONDAY),
            "Closing prices, the latest from Oct 30",
        );
    });

    test("a mix says how many are delayed", () => {
        assert.equal(
            describeQuotes([delayed("2026-11-02T15:42:00Z"), close("2026-10-30T20:00:00Z"), close("2026-10-30T20:00:00Z")], MONDAY),
            "Delayed quotes for 1 of 3, last closes for the rest",
        );
    });

    test("nothing without prices", () => {
        assert.equal(describeQuotes([], MONDAY), null);
    });
});

test("formatSessionDate adds the year only outside this one", () => {
    assert.equal(formatSessionDate("2026-10-30", MONDAY), "Oct 30");
    assert.equal(formatSessionDate("2025-10-30", MONDAY), "Oct 30, 2025");
});
