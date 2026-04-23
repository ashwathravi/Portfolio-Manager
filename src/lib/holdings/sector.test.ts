import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sectorFor, SECTOR_LABELS } from "./sector";

describe("holdings / sectorFor", () => {
    it("maps well-known tech tickers to Tech", () => {
        assert.equal(sectorFor("AAPL"), "Tech");
        assert.equal(sectorFor("MSFT"), "Tech");
        assert.equal(sectorFor("nvda"), "Tech"); // lowercase in
    });

    it("maps Tesla + Ford to Auto (spec calls for an Auto bucket)", () => {
        assert.equal(sectorFor("TSLA"), "Auto");
        assert.equal(sectorFor("F"), "Auto");
        assert.equal(sectorFor("GM"), "Auto");
    });

    it("maps the big banks + payment networks to Finance", () => {
        assert.equal(sectorFor("JPM"), "Finance");
        assert.equal(sectorFor("V"), "Finance");
        assert.equal(sectorFor("MA"), "Finance");
    });

    it("maps staples + discretionary names to Consumer", () => {
        assert.equal(sectorFor("WMT"), "Consumer");
        assert.equal(sectorFor("MCD"), "Consumer");
        assert.equal(sectorFor("NKE"), "Consumer");
    });

    it("falls through to Other for unknown tickers", () => {
        assert.equal(sectorFor("ZZZZZ"), "Other");
        assert.equal(sectorFor(""), "Other");
        assert.equal(sectorFor(undefined), "Other");
        assert.equal(sectorFor(null), "Other");
    });

    it("exposes a frozen label list that includes the spec's 5 chips", () => {
        for (const required of ["Tech", "Consumer", "Auto", "Finance"] as const) {
            assert.ok(SECTOR_LABELS.includes(required));
        }
        assert.ok(SECTOR_LABELS.includes("Other"));
    });
});
