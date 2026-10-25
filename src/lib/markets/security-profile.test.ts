import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { assetClassFor, fundSector, holdingName, loadSecurityProfiles, profileFromReference, sectorFromSic, type TickerReference } from "./security-profile";

describe("sectorFromSic", () => {
    test("well-known companies land in their sectors", () => {
        const cases: Array<[string, string, string]> = [
            ["AAPL", "3571", "Tech"], // electronic computers
            ["MSFT", "7372", "Tech"], // prepackaged software
            ["GOOGL", "7370", "Tech"],
            ["NVDA", "3674", "Tech"], // semiconductors
            ["TSLA", "3711", "Auto"],
            ["AMZN", "5961", "Consumer"], // catalog and mail-order retail
            ["KO", "2086", "Consumer"],
            ["PG", "2840", "Consumer"],
            ["JNJ", "2834", "Healthcare"],
            ["UNH", "6324", "Finance"], // hospital and medical service plans: insurance
            ["TMO", "3826", "Healthcare"],
            ["JPM", "6021", "Finance"],
            ["XOM", "2911", "Energy"],
            ["NFLX", "7841", "Communication"],
            ["T", "4813", "Communication"],
            ["NEE", "4911", "Utilities"],
            ["BA", "3721", "Industrials"],
            ["WM", "4953", "Industrials"],
            ["LIN", "2810", "Materials"],
            ["PLD", "6798", "Real estate"],
            ["MCK", "5122", "Healthcare"],
        ];
        for (const [symbol, sic, sector] of cases) assert.equal(sectorFromSic(sic), sector, symbol);
    });

    test("no code, a malformed code or one outside every range has no sector", () => {
        assert.equal(sectorFromSic(null), null);
        assert.equal(sectorFromSic(""), null);
        assert.equal(sectorFromSic("abc"), null);
        assert.equal(sectorFromSic("9995"), null); // non-operating establishments
        assert.equal(sectorFromSic(" 3571 "), "Tech");
    });
});

describe("fundSector", () => {
    test("bond, commodity and crypto funds by name; the rest are funds", () => {
        assert.equal(fundSector("Vanguard Total Bond Market ETF"), "Bonds");
        assert.equal(fundSector("iShares 20+ Year Treasury Bond ETF"), "Bonds");
        assert.equal(fundSector("SPDR Bloomberg 1-3 Month T-Bill ETF"), "Bonds");
        assert.equal(fundSector("SPDR Gold Shares"), "Commodities");
        assert.equal(fundSector("iShares Bitcoin Trust ETF"), "Crypto");
        assert.equal(fundSector("SPDR S&P 500 ETF Trust"), "Funds");
        assert.equal(fundSector("Technology Select Sector SPDR Fund"), "Funds");
        assert.equal(fundSector(null), "Funds");
    });
});

describe("assetClassFor", () => {
    test("Massive security types", () => {
        assert.equal(assetClassFor("CS"), "Stock");
        assert.equal(assetClassFor("ADRC"), "Stock");
        assert.equal(assetClassFor("etf"), "Fund");
        assert.equal(assetClassFor("ETN"), "Fund");
        assert.equal(assetClassFor("PFD"), "Preferred");
        assert.equal(assetClassFor("WARRANT"), "Warrant or right");
        assert.equal(assetClassFor("RIGHT"), "Warrant or right");
        assert.equal(assetClassFor(null), "Other");
        assert.equal(assetClassFor("SOMETHING"), "Other");
    });
});

describe("profileFromReference", () => {
    const base: TickerReference = {
        symbol: "aapl",
        name: " Apple Inc. ",
        type: "CS",
        primaryExchange: "XNAS",
        active: true,
        currency: "usd",
        sicCode: "3571",
        sicDescription: "ELECTRONIC COMPUTERS",
    };

    test("a stock's sector comes from its SIC code", () => {
        assert.deepEqual(profileFromReference(base), {
            symbol: "AAPL",
            name: "Apple Inc.",
            type: "CS",
            sector: "Tech",
            industry: "ELECTRONIC COMPUTERS",
        });
    });

    test("a fund's sector comes from its name, whatever SIC code it has", () => {
        const fund = profileFromReference({ ...base, symbol: "BND", name: "Vanguard Total Bond Market ETF", type: "ETF", sicCode: null, sicDescription: null });
        assert.deepEqual([fund.sector, fund.industry], ["Bonds", null]);
    });

    test("missing fields stay missing", () => {
        const bare = profileFromReference({ ...base, name: "  ", type: null, sicCode: null, sicDescription: null });
        assert.deepEqual([bare.name, bare.type, bare.sector, bare.industry], [null, null, null, null]);
    });
});

describe("holdingName", () => {
    test("the reference name, then the imported one unless it's the ticker, then the ticker", () => {
        assert.equal(holdingName("AAPL", "APPLE INC COM", { name: "Apple Inc." }), "Apple Inc.");
        assert.equal(holdingName("AAPL", "APPLE INC COM", null), "APPLE INC COM");
        assert.equal(holdingName("AAPL", "aapl", { name: null }), "AAPL");
        assert.equal(holdingName("AAPL", "  ", undefined), "AAPL");
    });
});

describe("loadSecurityProfiles", () => {
    test("a store that can't be read means no profiles, not a broken page", async () => {
        const original = console.warn;
        console.warn = () => {};
        try {
            const profiles = await loadSecurityProfiles(["AAPL"], async () => {
                throw new Error("connection refused");
            });
            assert.equal(profiles.size, 0);
        } finally {
            console.warn = original;
        }
    });
});
