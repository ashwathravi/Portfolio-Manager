import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    PLAID_TRANSACTIONS_PAGE,
    accountHoldings,
    accountTransactions,
    fetchPlaidHoldings,
    fetchPlaidInvestmentTransactions,
    mapPlaidTransaction,
    optionLotReadings,
    skippedByReason,
    transactionTypeForPlaid,
    PlaidDeadlineError,
    type PlaidHolding,
    type PlaidInvestmentTransaction,
    type PlaidSecurity,
} from "./investments";
import { PlaidApiError, type PlaidFetch } from "./link";

const ACCOUNT = "acc_brokerage";
const security = (id: string, fields: Partial<PlaidSecurity> = {}): PlaidSecurity => ({ security_id: id, ticker_symbol: id.toUpperCase(), name: `${id} Inc`, type: "equity", ...fields });
const holding = (securityId: string, fields: Partial<PlaidHolding> = {}): PlaidHolding => ({
    account_id: ACCOUNT, security_id: securityId, quantity: 10, institution_price: 100, institution_value: 1000, cost_basis: 800, iso_currency_code: "USD", ...fields,
});

describe("accountHoldings", () => {
    test("one row per ticker, its cost per share from Plaid's total cost basis, at the institution's price", () => {
        const result = accountHoldings(ACCOUNT, [
            holding("aapl"),
            // A second lot of the same security: combined, costs added.
            holding("aapl", { quantity: 5, institution_value: 500, cost_basis: 700 }),
            holding("msft", { quantity: 2, institution_price: 400, institution_value: 800, cost_basis: 600 }),
            // Another account's holding isn't this account's.
            holding("tsla", { account_id: "acc_other" }),
        ], [security("aapl"), security("msft"), security("tsla")]);
        assert.deepEqual(result.positions, [
            { symbol: "AAPL", name: "aapl Inc", quantity: 15, avgCost: 100, price: 100 },
            { symbol: "MSFT", name: "msft Inc", quantity: 2, avgCost: 300, price: 400 },
        ]);
        assert.deepEqual(result.skipped, []);
        assert.deepEqual(result.costUnknown, []);
    });

    test("cash and cash equivalents are the account's cash", () => {
        const result = accountHoldings(ACCOUNT, [
            holding("usd", { quantity: 1250.5, institution_price: 1, institution_value: 1250.5, cost_basis: null }),
            holding("spaxx", { quantity: 300, institution_price: 1, institution_value: 300, cost_basis: 300 }),
        ], [security("usd", { ticker_symbol: "CUR:USD", type: "cash" }), security("spaxx", { type: "mutual fund", is_cash_equivalent: true })]);
        assert.equal(result.cashUsd, 1550.5);
        assert.deepEqual(result.positions, []);
    });

    test("regression: what can't be a position is counted, not guessed", () => {
        const result = accountHoldings(ACCOUNT, [
            holding("opt"),
            holding("bond"),
            holding("shop", { iso_currency_code: "CAD" }),
            holding("btc", { iso_currency_code: null, unofficial_currency_code: "BTC" }),
            holding("short", { quantity: -5 }),
        ], [
            security("opt", { type: "derivative", ticker_symbol: "AAPL260116C00200000" }),
            security("bond", { type: "fixed income", ticker_symbol: null, name: "US Treasury 2030" }),
            security("shop"),
            security("btc", { type: "cryptocurrency" }),
            security("short"),
        ]);
        assert.deepEqual(result.positions, []);
        assert.deepEqual(result.skipped, [
            { reason: "option", name: "opt Inc" },
            { reason: "other-currency", name: "shop Inc" },
            { reason: "other-currency", name: "btc Inc" },
            { reason: "short", name: "short Inc" },
        ]);
        // Its contract's synced row, if a sync wrote one, stays as it was.
        assert.deepEqual(result.optionsKept, ["O:AAPL260116C00200000"]);
        assert.deepEqual(result.options, []);
    });

    test("regression: a holding with no ticker counts at the institution's value, valued by hand; with no value it can't", () => {
        // A 401(k)'s collective trust has a CUSIP and a value, no ticker:
        // it was dropped, and the account's value with it.
        const result = accountHoldings(ACCOUNT, [
            holding("cit", { quantity: 120.5, institution_price: 85, institution_value: 10242.5, cost_basis: 9000 }),
            holding("cit", { quantity: 10, institution_price: 85, institution_value: 850, cost_basis: null }),
            holding("private", { quantity: 1, institution_price: null, institution_value: null }),
        ], [
            security("cit", { ticker_symbol: null, name: "Target 2055 Trust", type: "mutual fund", cusip: "12345X678" }),
            security("private", { ticker_symbol: null, name: "Acme Holdings" }),
        ]);
        assert.deepEqual(result.positions, []);
        assert.deepEqual(result.institutionValued, [{
            externalId: "cit", name: "Target 2055 Trust", identifier: "12345X678", quantity: 130.5, value: 11092.5, costBasis: null, priceDate: null,
        }]);
        assert.deepEqual(result.skipped, [{ reason: "no-ticker", name: "Acme Holdings" }]);
    });

    test("a holding valued by the institution keeps the day Plaid gives its value; lots valued on different days, the earliest", () => {
        const trust = security("cit", { ticker_symbol: null, name: "Target 2055 Trust", cusip: "12345X678" });
        const dated = (asOf: unknown) => accountHoldings(ACCOUNT, [holding("cit", { quantity: 10, institution_value: 850, institution_price_as_of: asOf as string })], [trust]).institutionValued[0]?.priceDate;
        assert.equal(dated("2026-11-20"), "2026-11-20");
        assert.equal(dated("2026-11-20T21:00:00Z"), "2026-11-20");
        for (const undated of [null, "yesterday", "2026-02-30", 20261120]) assert.equal(dated(undated), null, String(undated));
        const lots = accountHoldings(ACCOUNT, [
            holding("cit", { quantity: 10, institution_value: 850, institution_price_as_of: "2026-11-20" }),
            holding("cit", { quantity: 5, institution_value: 425, institution_price_as_of: null }),
            holding("cit", { quantity: 1, institution_value: 85, institution_price_as_of: "2026-11-18" }),
        ], [trust]);
        assert.deepEqual(lots.institutionValued.map((v) => [v.value, v.priceDate]), [[1360, "2026-11-18"]]);
    });

    test("without a cost basis, a position is held at its price: no gain Plaid didn't report", () => {
        const result = accountHoldings(ACCOUNT, [holding("vti", { quantity: 4, institution_price: 250, cost_basis: null })], [security("vti")]);
        assert.deepEqual(result.positions, [{ symbol: "VTI", name: "vti Inc", quantity: 4, avgCost: 250, price: 250 }]);
        assert.deepEqual(result.costUnknown, ["VTI"]);
    });
});

describe("accountHoldings: option contracts (launch item i63)", () => {
    const CALL_DETAILS = { contract_type: "call", expiration_date: "2027-01-15", strike_price: 150, underlying_security_ticker: "ACME" };
    const acmeCall = (fields: Partial<PlaidSecurity> = {}) => security("acme_c", {
        type: "derivative", ticker_symbol: "ACME270115C00150000", name: "ACME Jan 15 2027 150 Call", option_contract: CALL_DETAILS, ...fields,
    });
    // Plaid's usual report: the quantity in shares (3 contracts × 100), the price per share.
    const acmeHolding = (fields: Partial<PlaidHolding> = {}) => holding("acme_c", {
        quantity: 300, institution_price: 4.2, institution_value: 1260, cost_basis: 1050, ...fields,
    });
    const ACME = {
        contract: "O:ACME270115C00150000", underlying: "ACME", contractType: "call", strike: 150, expiry: "2027-01-15",
        quantity: 3, premium: 3.5, price: 4.2, priceDate: null,
    };
    const only = (h: PlaidHolding, s: PlaidSecurity = acmeCall()) => accountHoldings(ACCOUNT, [h], [s]);
    const LEFT_OUT = { reason: "option", name: "ACME Jan 15 2027 150 Call" };

    test("an option with its contract's details is an option position: its contracts, the premium per share it cost, the institution's price", () => {
        const result = only(acmeHolding());
        assert.deepEqual(result.options, [ACME]);
        assert.deepEqual(
            [result.positions, result.institutionValued, result.skipped, result.costUnknown, result.optionsKept],
            [[], [], [], [], []],
        );
    });

    test("the number of contracts is read through the value the institution reports", () => {
        // Contracts at a price per share, and contracts at a price per contract.
        for (const fields of [{ quantity: 3, institution_price: 4.2 }, { quantity: 3, institution_price: 420 }]) {
            const result = only(acmeHolding({ ...fields, institution_value: 1260 }));
            assert.deepEqual(result.options, [ACME], JSON.stringify(fields));
        }
    });

    test("regression: a quantity no reading agrees with isn't guessed: the contract is left out, and its synced row kept", () => {
        // 2.5 contracts? 250 at $420? Neither comes to the reported value.
        const result = only(acmeHolding({ quantity: 250, institution_value: 2000 }));
        assert.deepEqual(result.options, []);
        assert.deepEqual(result.skipped, [LEFT_OUT]);
        assert.deepEqual(result.optionsKept, ["O:ACME270115C00150000"]);
    });

    test("without a price and a value to check against, only whole hundreds of shares read", () => {
        const hundreds = only(acmeHolding({ institution_price: null, institution_value: null }));
        assert.deepEqual(hundreds.options, [{ ...ACME, price: null, priceDate: null }]);
        const three = only(acmeHolding({ quantity: 3, institution_price: null, institution_value: null }));
        assert.deepEqual([three.options, three.skipped], [[], [LEFT_OUT]]);
    });

    test("a written contract is negative, at the premium received", () => {
        const result = only(acmeHolding({ quantity: -200, institution_price: 3, institution_value: -600, cost_basis: -500 }));
        assert.deepEqual(result.options, [{ ...ACME, quantity: -2, premium: 2.5, price: 3 }]);
    });

    test("without a cost basis it's held at the institution's price; with neither, it's left out", () => {
        const atPrice = only(acmeHolding({ cost_basis: null }));
        assert.deepEqual(atPrice.options, [{ ...ACME, premium: 4.2 }]);
        assert.deepEqual(atPrice.costUnknown, ["ACME Jan 15 2027 150 call"]);

        const neither = only(acmeHolding({ cost_basis: null, institution_price: null }));
        assert.deepEqual([neither.options, neither.skipped, neither.optionsKept], [[], [LEFT_OUT], ["O:ACME270115C00150000"]]);
    });

    test("a contract's lots are added up; long and short lots that cancel out are none", () => {
        const lots = accountHoldings(ACCOUNT, [
            acmeHolding({ quantity: 100, institution_value: 420, cost_basis: 350 }),
            acmeHolding({ quantity: 200, institution_value: 840, cost_basis: 700 }),
        ], [acmeCall()]);
        assert.deepEqual(lots.options, [ACME]);

        const closed = accountHoldings(ACCOUNT, [
            acmeHolding({ quantity: 100, institution_value: 420, cost_basis: 350 }),
            acmeHolding({ quantity: -100, institution_value: -420, cost_basis: -350 }),
        ], [acmeCall()]);
        assert.deepEqual([closed.options, closed.skipped, closed.optionsKept], [[], [], []]);
    });

    test("regression: a lot that can't be read leaves its whole contract out, not a part of it", () => {
        const result = accountHoldings(ACCOUNT, [
            acmeHolding({ quantity: 100, institution_value: 420, cost_basis: 350 }),
            acmeHolding({ quantity: 250, institution_value: 2000 }),
        ], [acmeCall()]);
        assert.deepEqual(result.options, []);
        assert.deepEqual(result.skipped, [LEFT_OUT, LEFT_OUT]);
        assert.deepEqual(result.optionsKept, ["O:ACME270115C00150000"]);
    });

    test("regression: details that aren't all there and valid leave the option out, its contract kept", () => {
        const cases: Record<string, unknown> = {
            "a type that isn't a call or put": { ...CALL_DETAILS, contract_type: "straddle" },
            "no strike": { ...CALL_DETAILS, strike_price: 0 },
            "a date that doesn't exist": { ...CALL_DETAILS, expiration_date: "2027-02-30" },
            "no underlying": { ...CALL_DETAILS, underlying_security_ticker: null },
            "no details": null,
            "a strike as text": { ...CALL_DETAILS, strike_price: "150" },
        };
        for (const [label, details] of Object.entries(cases)) {
            const result = only(acmeHolding(), acmeCall({ option_contract: details }));
            assert.deepEqual([result.options, result.skipped, result.optionsKept], [[], [LEFT_OUT], ["O:ACME270115C00150000"]], label);
        }
    });

    test("a symbol that disagrees with the details isn't read", () => {
        const result = only(acmeHolding(), acmeCall({ ticker_symbol: "ACME270115P00150000" }));
        assert.deepEqual([result.options, result.skipped], [[], [LEFT_OUT]]);
    });

    test("an adjusted contract isn't read; a weekly keeps its root, and BRK.B is BRKB", () => {
        const adjusted = only(acmeHolding(), acmeCall({ ticker_symbol: "ACME1270115C00150000" }));
        assert.deepEqual([adjusted.options, adjusted.skipped], [[], [LEFT_OUT]]);

        const weekly = only(
            acmeHolding({ quantity: 100, institution_price: 21.5, institution_value: 2150, cost_basis: 1800 }),
            acmeCall({ ticker_symbol: "SPXW261218C05000000", option_contract: { contract_type: "Call", expiration_date: "2026-12-18", strike_price: 5000, underlying_security_ticker: "SPX" } }),
        );
        assert.deepEqual(weekly.options.map((o) => [o.contract, o.underlying, o.quantity, o.premium]), [["O:SPXW261218C05000000", "SPX", 1, 18]]);

        const dotted = only(
            acmeHolding(),
            acmeCall({ ticker_symbol: "BRKB270115C00500000", option_contract: { ...CALL_DETAILS, strike_price: 500, underlying_security_ticker: "BRK.B" } }),
        );
        assert.deepEqual(dotted.options.map((o) => [o.contract, o.underlying]), [["O:BRKB270115C00500000", "BRK.B"]]);
    });

    test("regression: an option Plaid gives no type is never a holding the institution values", () => {
        const result = only(acmeHolding(), acmeCall({ type: null, option_contract: undefined }));
        assert.deepEqual([result.institutionValued, result.options, result.skipped], [[], [], [LEFT_OUT]]);
        assert.deepEqual(result.optionsKept, ["O:ACME270115C00150000"]);
    });

    test("a contract's symbol that Plaid types as a stock is an option all the same", () => {
        // Its symbol is no ticker, so it would have been a holding the institution values.
        const bare = only(acmeHolding(), acmeCall({ type: "equity", option_contract: undefined }));
        assert.deepEqual(
            [bare.institutionValued, bare.positions, bare.options, bare.skipped, bare.optionsKept],
            [[], [], [], [LEFT_OUT], ["O:ACME270115C00150000"]],
        );
        // With its details, it's an option position.
        const detailed = only(acmeHolding(), acmeCall({ type: "equity" }));
        assert.deepEqual([detailed.options, detailed.institutionValued, detailed.skipped], [[ACME], [], []]);
    });

    test("an option in another currency is counted as one", () => {
        const result = only(acmeHolding({ iso_currency_code: "CAD" }));
        assert.deepEqual([result.options, result.skipped], [[], [{ reason: "other-currency", name: "ACME Jan 15 2027 150 Call" }]]);
    });

    test("the day of the institution's price is kept when Plaid gives a real one", () => {
        assert.equal(only(acmeHolding({ institution_price_as_of: "2026-10-23" })).options[0]?.priceDate, "2026-10-23");
        assert.equal(only(acmeHolding({ institution_price_as_of: "2026-10-23T20:00:00Z" })).options[0]?.priceDate, "2026-10-23");
        assert.equal(only(acmeHolding({ institution_price_as_of: "yesterday" })).options[0]?.priceDate, null);
        // A day without its price is no price.
        assert.equal(only(acmeHolding({ institution_price: null, institution_value: null, institution_price_as_of: "2026-10-23" })).options[0]?.priceDate, null);
    });

    test("regression: a contract's lots take the price and its day from the same lot", () => {
        // The first lot has a day but no price; the second has a price as of a later day.
        const dayWithoutPrice = accountHoldings(ACCOUNT, [
            acmeHolding({ quantity: 100, institution_price: null, institution_value: null, cost_basis: 350, institution_price_as_of: "2026-10-20" }),
            acmeHolding({ quantity: 200, institution_value: 840, cost_basis: 700, institution_price_as_of: "2026-10-23" }),
        ], [acmeCall()]);
        assert.deepEqual(dayWithoutPrice.options, [{ ...ACME, priceDate: "2026-10-23" }]);

        // A price with no day is the sync's, the newest: another lot's day isn't its day.
        const undated = acmeHolding({ quantity: 100, institution_value: 420, cost_basis: 350 });
        const dated = acmeHolding({ quantity: 200, institution_price: 4.3, institution_value: 860, cost_basis: 700, institution_price_as_of: "2026-10-23" });
        for (const lots of [[undated, dated], [dated, undated]]) {
            assert.deepEqual(accountHoldings(ACCOUNT, lots, [acmeCall()]).options, [ACME], String(lots[0].institution_price_as_of ?? "undated"));
        }

        // Prices of different days, in either order: the newest, with its day.
        const tuesdays = acmeHolding({ quantity: 100, institution_value: 420, cost_basis: 350, institution_price_as_of: "2026-10-20" });
        for (const lots of [[tuesdays, dated], [dated, tuesdays]]) {
            assert.deepEqual(accountHoldings(ACCOUNT, lots, [acmeCall()]).options, [{ ...ACME, price: 4.3, priceDate: "2026-10-23" }], String(lots[0].institution_price_as_of));
        }
    });

    test("an option with no contracts is dropped, not counted", () => {
        const result = only(acmeHolding({ quantity: 0, institution_value: 0 }));
        assert.deepEqual([result.options, result.skipped, result.optionsKept], [[], [], []]);
    });

    // An institution that reports contracts at a price per contract: 300
    // contracts at $420 each are worth what 300 shares (3 contracts) at $420
    // a share are, so the value alone can't tell them apart.
    const PUT_DETAILS = { ...CALL_DETAILS, contract_type: "put" };
    const acmePut = (fields: Partial<PlaidSecurity> = {}) => security("acme_p", {
        type: "derivative", ticker_symbol: "ACME270115P00150000", name: "ACME Jan 15 2027 150 Put", option_contract: PUT_DETAILS, ...fields,
    });
    const ACME_PUT = { ...ACME, contract: "O:ACME270115P00150000", contractType: "put" };
    const perContract = (contracts: number, fields: Partial<PlaidHolding> = {}) => holding("acme_c", {
        quantity: contracts, institution_price: 420, institution_value: contracts * 420, cost_basis: contracts * 350, ...fields,
    });
    const acmeStock = (price: number) => holding("acme", { quantity: 10, institution_price: price, institution_value: price * 10, cost_basis: 1000 });
    // The day of the institution's price, and a session weeks before it.
    const DAY = "2026-10-23";
    const WEEKS_BEFORE = "2026-09-25";

    test("regression: a written put of 300 contracts priced per contract is 300 contracts at $4.20 a share, not 3 at $420", () => {
        // $420 a share on a $150 put is a price no put can have.
        const result = only(holding("acme_p", { quantity: -300, institution_price: 420, institution_value: -126_000, cost_basis: -105_000 }), acmePut());
        assert.deepEqual(result.options, [{ ...ACME_PUT, quantity: -300, premium: 3.5, price: 4.2 }]);
        assert.deepEqual([result.skipped, result.optionsKept], [[], []]);
    });

    test("regression: a contract's lots are read the same way, in either order", () => {
        // 100 contracts read as 1 at $420 a share too, but 50 can't, so both are contracts at a price per contract.
        for (const lots of [[perContract(100), perContract(50)], [perContract(50), perContract(100)]]) {
            const result = accountHoldings(ACCOUNT, lots, [acmeCall()]);
            assert.deepEqual(result.options, [{ ...ACME, quantity: 150, premium: 3.5, price: 4.2 }], JSON.stringify(lots.map((l) => l.quantity)));
        }
        // Lots priced on different days: a close is checked against the newest
        // price, whichever lot Plaid lists first. Friday's close is from that
        // price's session, two weeks after the other lot's.
        const fridays = perContract(100, { institution_price_as_of: DAY });
        const older = perContract(200, { institution_price_as_of: "2026-10-09" });
        for (const lots of [[fridays, older], [older, fridays]]) {
            const result = accountHoldings(ACCOUNT, lots, [acmeCall()], { contractCloses: new Map([["O:ACME270115C00150000", { close: 4.25, date: DAY }]]) });
            assert.deepEqual(result.options, [{ ...ACME, quantity: 300, premium: 3.5, price: 4.2, priceDate: DAY }], lots.map((l) => l.institution_price_as_of).join());
        }
    });

    test("regression: lots of a contract that read in no one way are left out, and its synced row kept", () => {
        // 300 shares at $4.20 a share, and 3 contracts at $4.20 a share.
        const result = accountHoldings(ACCOUNT, [acmeHolding(), acmeHolding({ quantity: 3 })], [acmeCall()]);
        assert.deepEqual([result.options, result.skipped, result.optionsKept], [[], [LEFT_OUT, LEFT_OUT], ["O:ACME270115C00150000"]]);
    });

    test("lots in whole hundreds stay shares at a price per share unless something says otherwise", () => {
        // Nothing does: 300 at $420 is 3 contracts at $420 a share, as Plaid documents it.
        assert.deepEqual(only(perContract(300)).options, [{ ...ACME, quantity: 3, premium: 350, price: 420 }]);
        // A call is never worth more than its underlying: at $145 a share, $420 can't be a share's price.
        const belowPrice = accountHoldings(ACCOUNT, [perContract(300), acmeStock(145)], [acmeCall(), security("acme")]);
        assert.deepEqual(belowPrice.options, [{ ...ACME, quantity: 300, premium: 3.5, price: 4.2 }]);
        // Nor is either worth much under what it's worth exercised: with ACME at $160, $0.105 can't be
        // this call's price a share, even where the institution prices its other contracts per contract.
        const put = holding("acme_p", { quantity: 50, institution_price: 420, institution_value: 21_000, cost_basis: 17_500 });
        const exercised = accountHoldings(ACCOUNT, [acmeHolding({ institution_price: 10.5, institution_value: 3150 }), put, acmeStock(160)], [acmeCall(), acmePut(), security("acme")]);
        assert.deepEqual(exercised.options[0], { ...ACME, price: 10.5 });
    });

    test("the stored close and the underlying's stored price settle a contract that reads two ways", () => {
        const contract = "O:ACME270115C00150000";
        const closed = (close: number) => accountHoldings(ACCOUNT, [perContract(300, { institution_price_as_of: DAY })], [acmeCall()], {
            contractCloses: new Map([[contract, { close, date: DAY }]]),
        }).options;
        assert.deepEqual(closed(4.25), [{ ...ACME, quantity: 300, premium: 3.5, price: 4.2, priceDate: DAY }]);
        assert.deepEqual(closed(410), [{ ...ACME, quantity: 3, premium: 350, price: 420, priceDate: DAY }]);
        // A close that far from both says nothing: Plaid's shares stand.
        assert.deepEqual(closed(30), [{ ...ACME, quantity: 3, premium: 350, price: 420, priceDate: DAY }]);
        // A price Plaid doesn't date is the sync's last session's.
        const undated = (undatedPriceDay?: string) => accountHoldings(ACCOUNT, [perContract(300)], [acmeCall()], {
            contractCloses: new Map([[contract, { close: 4.25, date: DAY }]]), undatedPriceDay,
        }).options.map((o) => o.quantity);
        assert.deepEqual(
            [undated(DAY), undated("2026-10-26"), undated("2026-10-27"), undated(), undated("2026-10-28")],
            [[300], [300], [300], [3], [3]],
        );

        const stored = accountHoldings(ACCOUNT, [perContract(300)], [acmeCall()], { underlyingPrices: new Map([["ACME", 145]]) });
        assert.deepEqual(stored.options, [{ ...ACME, quantity: 300, premium: 3.5, price: 4.2 }]);
        // The institution's price for the underlying comes before a stored one.
        const both = accountHoldings(ACCOUNT, [acmeHolding({ institution_price: 10.5, institution_value: 3150 }), acmeStock(160)], [acmeCall(), security("acme")], {
            underlyingPrices: new Map([["ACME", 1]]),
        });
        assert.deepEqual(both.options, [{ ...ACME, price: 10.5 }]);
    });

    test("regression: when the price's bounds and the stored close disagree, the contract is left out and its row kept", () => {
        const put = holding("acme_p", { quantity: -300, institution_price: 420, institution_value: -126_000, cost_basis: -105_000 });
        const result = accountHoldings(ACCOUNT, [put], [acmePut()], {
            contractCloses: new Map([["O:ACME270115P00150000", { close: 400, date: DAY }]]), undatedPriceDay: DAY,
        });
        assert.deepEqual(
            [result.options, result.skipped, result.optionsKept],
            [[], [{ reason: "option", name: "ACME Jan 15 2027 150 Put" }], ["O:ACME270115P00150000"]],
        );
    });

    test("regression: a stored close from weeks before the price says nothing about how its lots read", () => {
        // A cheap call as Plaid documents it: 3 contracts at $0.40 a share. Its last
        // trade, weeks before, was at $0.01, within three times of $0.004: the price
        // read per contract, as 300 contracts.
        const contract = "O:ACME270115C00150000";
        const cheap = acmeHolding({ institution_price: 0.4, institution_value: 120, cost_basis: 30, institution_price_as_of: DAY });
        const read = (date: string | null) => accountHoldings(ACCOUNT, [cheap], [acmeCall()], {
            contractCloses: new Map([[contract, { close: 0.01, date }]]), underlyingPrices: new Map([["ACME", 100]]),
        });
        for (const date of [WEEKS_BEFORE, "2026-10-20", "2026-10-27", null]) {
            assert.deepEqual(read(date).options, [{ ...ACME, quantity: 3, premium: 0.1, price: 0.4, priceDate: DAY }], String(date));
        }
        // A close from the price's session, one of the two before it, or the one after it, is asked.
        for (const date of [DAY, "2026-10-21", "2026-10-22", "2026-10-26"]) {
            assert.deepEqual(read(date).options.map((o) => [o.quantity, o.premium, o.price]), [[300, 0.001, 0.004]], date);
        }

        // In the money, 3 contracts at $60 a share on ACME at $210: a close of $0.65
        // weeks before fits $0.60 a share, well under what the call is worth
        // exercised, and the contract was left out and its synced row kept.
        const deep = acmeHolding({ institution_price: 60, institution_value: 18_000, cost_basis: 1500, institution_price_as_of: DAY });
        const result = accountHoldings(ACCOUNT, [deep], [acmeCall()], {
            contractCloses: new Map([[contract, { close: 0.65, date: WEEKS_BEFORE }]]), underlyingPrices: new Map([["ACME", 210]]),
        });
        assert.deepEqual(result.options, [{ ...ACME, quantity: 3, premium: 5, price: 60, priceDate: DAY }]);
        assert.deepEqual([result.skipped, result.optionsKept], [[], []]);
    });

    test("a close is from a price's session by the market's days: a weekend's or a holiday's price is the session's before it", () => {
        const contract = "O:ACME270115C00150000";
        const read = (priceDay: string, closeDay: string) => accountHoldings(ACCOUNT, [perContract(300, { institution_price_as_of: priceDay })], [acmeCall()], {
            contractCloses: new Map([[contract, { close: 4.25, date: closeDay }]]),
        }).options.map((o) => o.quantity);
        // Saturday's price is Friday's: Wednesday's close to Monday's is asked, and none further.
        for (const day of ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26"]) assert.deepEqual(read("2026-10-24", day), [300], day);
        for (const day of ["2026-10-20", "2026-10-27"]) assert.deepEqual(read("2026-10-24", day), [3], day);
        // Thanksgiving's is Wednesday's: Monday's close to Friday's, the market shut between.
        for (const day of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27"]) assert.deepEqual(read("2026-11-26", day), [300], day);
        for (const day of ["2026-11-20", "2026-11-30"]) assert.deepEqual(read("2026-11-26", day), [3], day);
        // A day before the market's calendar starts says nothing, and doesn't stop the sync: Plaid's shares stand.
        for (const day of ["2017-12-29", "0001-01-01"]) assert.deepEqual(read(day, DAY), [3], day);
        assert.deepEqual(read(DAY, "2017-12-29"), [3]);
    });

    test("regression: the nightly sync counts the close the prices job stored the night before, two sessions before its price", () => {
        // Massive's free plan publishes a session's bars after midnight Eastern,
        // after the nightly jobs: Monday night's prices job stores Friday's close,
        // and Tuesday night's sync, its price dated Tuesday, has that close two
        // sessions before it. The first sync wrote Plaid's shares, 3 contracts.
        const contract = "O:ACME270115C00150000";
        const read = (undatedPriceDay: string) => accountHoldings(ACCOUNT, [perContract(300)], [acmeCall()], {
            contractCloses: new Map([[contract, { close: 4.25, date: DAY }]]), undatedPriceDay,
            syncedOptions: new Map([[ACCOUNT, new Map([[contract, { contracts: 3, perShare: 420 }]])]]),
        }).options.map((o) => [o.quantity, o.premium, o.price]);
        assert.deepEqual(read("2026-10-27"), [[300, 3.5, 4.2]]);
        // Three sessions before is too old to settle it: the row's shares stand.
        assert.deepEqual(read("2026-10-28"), [[3, 350, 420]]);
    });

    test("regression: when nothing else settles a contract, the reading nearest its synced row's contracts and price stands", () => {
        // An institution that prices per contract: its close of $4.25 a share, from
        // Friday, read 300 at $420 as 300 contracts on Monday. On Wednesday's sync the
        // close is three sessions old, the nightly job not having stored a newer one.
        const contract = "O:ACME270115C00150000";
        const row = (contracts: number, perShare: number | null, account = ACCOUNT) => new Map([[account, new Map([[contract, { contracts, perShare }]])]]);
        const wednesday = (lots: PlaidHolding[], syncedOptions?: ReturnType<typeof row>, close = { close: 4.25, date: DAY }) =>
            accountHoldings(ACCOUNT, lots, [acmeCall()], { contractCloses: new Map([[contract, close]]), undatedPriceDay: "2026-10-28", syncedOptions })
                .options.map((o) => [o.quantity, o.premium, o.price]);
        assert.deepEqual(wednesday([perContract(300)], row(300, 4.2)), [[300, 3.5, 4.2]]);
        // Contracts bought or sold since, however many and on either side, don't take the row out of its reading.
        assert.deepEqual(wednesday([perContract(400)], row(300, 4.2)), [[400, 3.5, 4.2]]);
        assert.deepEqual(wednesday([perContract(100)], row(10, 4.2)), [[100, 3.5, 4.2]]);
        assert.deepEqual(wednesday([perContract(100)], row(2000, 4.2)), [[100, 3.5, 4.2]]);
        assert.deepEqual(wednesday([perContract(-300)], row(300, 4.2)), [[-300, 3.5, 4.2]]);
        // Nor does the option moving more than three times from its close, one from
        // about its price's session or a weeks-old one: 300 contracts at $0.50 a share
        // are $2.00 a share tonight.
        const quadrupled = perContract(300, { institution_price: 200, institution_value: 60_000 });
        for (const date of ["2026-10-27", "2026-10-26", WEEKS_BEFORE]) {
            assert.deepEqual(wednesday([quadrupled], row(300, 0.5), { close: 0.5, date }), [[300, 3.5, 2]], date);
        }
        // Or sliding so far from a weeks-old close of $0.50 that the close fits the
        // other reading: $1 a contract is within three times of it read a share.
        const slid = perContract(300, { institution_price: 1, institution_value: 300 });
        assert.deepEqual(wednesday([slid], row(300, 0.012), { close: 0.5, date: WEEKS_BEFORE }), [[300, 3.5, 0.01]]);

        // A row in Plaid's shares stays in them, and so does a contract with no row, or
        // only another account's.
        assert.deepEqual(wednesday([perContract(300)], row(3, 420)), [[3, 350, 420]]);
        assert.deepEqual(wednesday([perContract(300)]), [[3, 350, 420]]);
        assert.deepEqual(wednesday([perContract(300)], row(300, 4.2, "acc_other")), [[3, 350, 420]]);
        // A row with no price is read by its contracts alone.
        assert.deepEqual(wednesday([perContract(300)], row(300, null)), [[300, 3.5, 4.2]]);
        assert.deepEqual(wednesday([perContract(300)], row(3, null)), [[3, 350, 420]]);
        // The same 300 contracts at $4.20 a share read as the row however the
        // institution reports them, as Plaid documents them too.
        const documented = acmeHolding({ quantity: 30_000, institution_value: 126_000, cost_basis: 105_000 });
        assert.deepEqual(wednesday([documented], row(300, 4.2)), [[300, 3.5, 4.2]]);
        // Lots as near the row either way, a hundredth of its contracts or of its
        // price, say nothing: Plaid's shares stand.
        assert.deepEqual(wednesday([acmeHolding()], row(300, 4.2)), [[3, 3.5, 4.2]]);

        // The cheap call a weeks-old close of $0.01 fits read per contract: its row of
        // 3 contracts at $0.40 a share keeps it 3.
        const cheap = acmeHolding({ institution_price: 0.4, institution_value: 120, cost_basis: 30, institution_price_as_of: DAY });
        const result = accountHoldings(ACCOUNT, [cheap], [acmeCall()], {
            contractCloses: new Map([[contract, { close: 0.01, date: WEEKS_BEFORE }]]), underlyingPrices: new Map([["ACME", 100]]), syncedOptions: row(3, 0.4),
        });
        assert.deepEqual(result.options, [{ ...ACME, quantity: 3, premium: 0.1, price: 0.4, priceDate: DAY }]);
    });

    test("regression: a night its lots have no price, a contract whose synced row is read per contract is left out and its row kept", () => {
        // Lots with no price and value to check them against read only as Plaid's shares.
        const contract = "O:ACME270115C00150000";
        const row = (contracts: number, perShare: number | null) => new Map([[ACCOUNT, new Map([[contract, { contracts, perShare }]])]]);
        const read = (lots: PlaidHolding[], syncedOptions?: ReturnType<typeof row>) => {
            const result = accountHoldings(ACCOUNT, lots, [acmeCall()], { syncedOptions });
            return [result.options.map((o) => [o.quantity, o.premium, o.price]), result.skipped, result.optionsKept];
        };
        for (const unpriced of [perContract(300, { institution_price: 0, institution_value: 0 }), perContract(300, { institution_price: null, institution_value: null })]) {
            const label = String(unpriced.institution_price);
            assert.deepEqual(read([unpriced], row(300, 4.2)), [[], [LEFT_OUT], [contract]], label);
            assert.deepEqual(read([unpriced], row(300, null)), [[], [LEFT_OUT], [contract]], label);
            // With a row in Plaid's shares, or none, they're its shares, at no price.
            assert.deepEqual(read([unpriced], row(3, 420)), [[[3, 350, null]], [], []], label);
            assert.deepEqual(read([unpriced]), [[[3, 350, null]], [], []], label);
        }
        // So are lots as Plaid documents them, 30,000 shares for the row's 300 contracts.
        const documented = acmeHolding({ quantity: 30_000, institution_price: 0, institution_value: 0, cost_basis: 105_000 });
        assert.deepEqual(read([documented], row(300, 4.2)), [[[300, 3.5, null]], [], []]);
        // One lot with no price is enough to leave the contract out.
        const lots = [perContract(200), perContract(100, { institution_price: 0, institution_value: 0 })];
        assert.deepEqual(read(lots, row(300, 4.2)), [[], [LEFT_OUT, LEFT_OUT], [contract]]);
    });

    test("an institution that prices its other contracts per contract settles one that reads two ways", () => {
        // 50 puts at $420 each read only as contracts at a price per contract.
        const put = holding("acme_p", { quantity: 50, institution_price: 420, institution_value: 21_000, cost_basis: 17_500 });
        const result = accountHoldings(ACCOUNT, [perContract(300), put], [acmeCall(), acmePut()]);
        assert.deepEqual(result.options, [
            { ...ACME, quantity: 300, premium: 3.5, price: 4.2 },
            { ...ACME_PUT, quantity: 50, premium: 3.5, price: 4.2 },
        ]);
        // Without a symbol to confirm it, the put may be an adjusted contract: it settles nothing.
        const unconfirmed = accountHoldings(ACCOUNT, [perContract(300), put], [acmeCall(), acmePut({ ticker_symbol: null })]);
        assert.deepEqual(unconfirmed.options.map((o) => [o.contract, o.quantity]), [["O:ACME270115C00150000", 3], ["O:ACME270115P00150000", 50]]);
        // Nor does it in an institution that also reports contracts at a price per share.
        const mixed = accountHoldings(ACCOUNT, [perContract(300), put, holding("acme_c2", { quantity: 3, institution_price: 4.2, institution_value: 1260 })], [
            acmeCall(),
            acmePut(),
            acmeCall({ security_id: "acme_c2", ticker_symbol: "ACME270115C00160000", option_contract: { ...CALL_DETAILS, strike_price: 160 } }),
        ]);
        assert.equal(mixed.options.find((o) => o.contract === "O:ACME270115C00150000")?.quantity, 3);
    });

    test("optionLotReadings: within rounding of the value it reads, further off it doesn't, and never a fraction of a contract", () => {
        // Shares at a price per share and contracts at a price per contract come to the same worth.
        assert.deepEqual(optionLotReadings(300, 4.2, 1260 * 1.01), ["shares", "per-contract"]);
        assert.deepEqual(optionLotReadings(150, 420, 63_000), ["per-contract"]);
        assert.deepEqual(optionLotReadings(3, 4.2, 1260), ["contracts"]);
        assert.deepEqual(optionLotReadings(300, 4.2, 1260 * 1.1), []);
        assert.deepEqual(optionLotReadings(2.5, 4.2, 1050), []);
        assert.deepEqual(optionLotReadings(250, null, null), []);
        // A price of 0 is no price to check against.
        assert.deepEqual(optionLotReadings(-500, 0, 0), ["shares"]);
    });

    test("skippedByReason counts each reason", () => {
        assert.deepEqual(
            skippedByReason([{ reason: "option" }, { reason: "short" }, { reason: "option" }]),
            { option: 2, short: 1 },
        );
    });
});

const transaction = (fields: Partial<PlaidInvestmentTransaction>): PlaidInvestmentTransaction => ({
    investment_transaction_id: "txn_1",
    account_id: ACCOUNT,
    security_id: "aapl",
    date: "2026-03-05",
    name: "BUY APPLE INC",
    quantity: 10,
    amount: 1500.05,
    price: 150,
    fees: 0.05,
    type: "buy",
    subtype: "buy",
    iso_currency_code: "USD",
    ...fields,
});

describe("Plaid investment transactions", () => {
    test("types and subtypes as Atlas records them", () => {
        const cases: [string, string | null, string | null][] = [
            ["buy", "buy", "BUY"],
            ["buy", "dividend reinvestment", "BUY"],
            ["sell", "sell", "SELL"],
            ["fee", "management fee", "FEE"],
            ["cash", "qualified dividend", "DIVIDEND"],
            ["cash", "long-term capital gain", "DIVIDEND"],
            ["cash", "interest", "INTEREST"],
            ["cash", "contribution", "DEPOSIT"],
            ["cash", "deposit", "DEPOSIT"],
            ["cash", "withdrawal", "WITHDRAWAL"],
            ["cash", "distribution", "WITHDRAWAL"],
            ["cash", "tax withheld", "FEE"],
            ["cash", "adjustment", null],
            // A transfer without a quantity says nothing about shares.
            ["transfer", "send", null],
            ["cancel", null, null],
        ];
        for (const [type, subtype, expected] of cases) assert.equal(transactionTypeForPlaid(type, subtype), expected, `${type}/${subtype}`);
    });

    test("share transfers: shares in, shares out, and a vest by its description; corporate actions aren't recorded", () => {
        assert.equal(transactionTypeForPlaid("transfer", "transfer", { quantity: 25, name: "TRANSFER OF SECURITIES" }), "TRANSFER_IN");
        assert.equal(transactionTypeForPlaid("transfer", "send", { quantity: -25, name: "ACAT OUT" }), "TRANSFER_OUT");
        assert.equal(transactionTypeForPlaid("transfer", "stock distribution", { quantity: 12, name: "RSU VEST GOOG" }), "VEST");
        assert.equal(transactionTypeForPlaid("transfer", "transfer", { quantity: 12, name: "Shares released - restricted stock" }), "VEST");
        // A negative vest-like row is shares leaving (sold to cover), not a vest.
        assert.equal(transactionTypeForPlaid("transfer", "transfer", { quantity: -4, name: "RSU VEST GOOG" }), "TRANSFER_OUT");
        assert.equal(transactionTypeForPlaid("transfer", "transfer", { quantity: 0 }), null);
        assert.equal(transactionTypeForPlaid("transfer", "split", { quantity: 10 }), null);
        assert.equal(transactionTypeForPlaid("transfer", "merger", { quantity: 10 }), null);
        assert.equal(transactionTypeForPlaid("transfer", "exercise", { quantity: 10 }), null);
    });

    test("regression: an RSU vest Plaid reports as a transfer is kept, valued at the day's price, with no cash amount", () => {
        const vest = mapPlaidTransaction(
            transaction({ type: "transfer", subtype: "transfer", quantity: 12, price: 170.25, amount: 0, fees: null, name: "RSU VEST" }),
            security("goog"),
        );
        assert.ok("row" in vest);
        assert.deepEqual(
            [vest.row.type, vest.row.symbol, vest.row.quantity, vest.row.price, vest.row.amount],
            ["VEST", "GOOG", 12, 170.25, null],
        );
        const out = mapPlaidTransaction(transaction({ type: "transfer", subtype: "send", quantity: -5, price: 0, amount: 0, fees: null, name: "ACAT OUT" }), security("aapl"));
        assert.ok("row" in out);
        assert.deepEqual([out.row.type, out.row.quantity, out.row.price], ["TRANSFER_OUT", 5, null]);
        assert.deepEqual(mapPlaidTransaction(transaction({ type: "transfer", subtype: "transfer" }), security("aapl", { ticker_symbol: null })), { skipped: "no-symbol" });
    });

    test("a buy keeps its quantity, price, net amount and fees; a sell's negative quantity is a quantity", () => {
        const buy = mapPlaidTransaction(transaction({}), security("aapl"));
        assert.ok("row" in buy);
        assert.deepEqual(buy.row, {
            type: "BUY", date: "2026-03-05", symbol: "AAPL", quantity: 10, price: 150, amount: 1500.05, fees: 0.05,
            currency: "USD", notes: "BUY APPLE INC", externalId: "plaid:txn_1",
        });
        const sell = mapPlaidTransaction(transaction({ type: "sell", subtype: "sell", quantity: -4, amount: -599.95 }), security("aapl"));
        assert.ok("row" in sell);
        assert.deepEqual([sell.row.type, sell.row.quantity, sell.row.amount], ["SELL", 4, 599.95]);
    });

    test("cash movements take an amount; a dividend needs its security", () => {
        const dividend = mapPlaidTransaction(transaction({ type: "cash", subtype: "dividend", quantity: 0, price: 0, amount: -7.5, fees: null }), security("msft"));
        assert.ok("row" in dividend);
        assert.deepEqual([dividend.row.type, dividend.row.symbol, dividend.row.quantity, dividend.row.price, dividend.row.amount], ["DIVIDEND", "MSFT", null, null, 7.5]);

        const interest = mapPlaidTransaction(transaction({ type: "cash", subtype: "interest", security_id: null, amount: -1.25 }), undefined);
        assert.ok("row" in interest);
        assert.deepEqual([interest.row.type, interest.row.symbol, interest.row.amount], ["INTEREST", null, 1.25]);

        // Interest paid on the cash sweep names the cash security: no symbol.
        const sweep = mapPlaidTransaction(transaction({ type: "cash", subtype: "interest", amount: -0.4 }), security("usd", { ticker_symbol: "CUR:USD", type: "cash" }));
        assert.ok("row" in sweep);
        assert.equal(sweep.row.symbol, null);

        assert.deepEqual(mapPlaidTransaction(transaction({ type: "cash", subtype: "dividend", security_id: null }), undefined), { skipped: "no-symbol" });
    });

    test("regression: a money market sweep's dividends keep its ticker; buying and selling it moves cash", () => {
        // The Codex finding on PR #162: the fund's ticker was dropped, so its
        // dividends were skipped. The holdings count it as cash, so its buys
        // and sells are moves within cash, not trades.
        const spaxx = security("spaxx", { type: "mutual fund", is_cash_equivalent: true });
        const dividend = mapPlaidTransaction(transaction({ type: "cash", subtype: "dividend", amount: -3.21, quantity: 0, price: 0 }), spaxx);
        assert.ok("row" in dividend);
        assert.deepEqual([dividend.row.type, dividend.row.symbol, dividend.row.amount], ["DIVIDEND", "SPAXX", 3.21]);
        assert.deepEqual(mapPlaidTransaction(transaction({ type: "buy", subtype: "dividend reinvestment" }), spaxx), { skipped: "cash-sweep" });
        assert.deepEqual(mapPlaidTransaction(transaction({ type: "sell", subtype: "sell", quantity: -50 }), spaxx), { skipped: "cash-sweep" });
    });

    test("regression: what Atlas doesn't record, or can't, is left out with a reason", () => {
        assert.deepEqual(mapPlaidTransaction(transaction({ type: "transfer", subtype: "split" }), security("aapl")), { skipped: "not-recorded" });
        assert.deepEqual(mapPlaidTransaction(transaction({ type: "cancel", subtype: null }), security("aapl")), { skipped: "not-recorded" });
        assert.deepEqual(mapPlaidTransaction(transaction({ iso_currency_code: null, unofficial_currency_code: "BTC" }), security("btc")), { skipped: "other-currency" });
        // A trade without a price can't be recorded as one.
        assert.deepEqual(mapPlaidTransaction(transaction({ price: null }), security("aapl")), { skipped: "invalid" });
        assert.deepEqual(mapPlaidTransaction(transaction({}), security("aapl", { ticker_symbol: null })), { skipped: "no-symbol" });
    });

    test("regression: an option trade isn't recorded, even when Plaid gives the contract a short ticker; a fee on one is", () => {
        // A derivative Plaid tickers "ACME" was recorded as a trade of ACME
        // shares; one with its contract's symbol was left out as having none,
        // as was that symbol typed as a stock.
        const shortTicker = security("acme_c", { type: "derivative", ticker_symbol: "ACME" });
        const occ = security("acme_c", { type: "derivative", ticker_symbol: "ACME270115C00150000" });
        const typedAsStock = security("acme_c", { type: "equity", ticker_symbol: "ACME270115C00150000" });
        for (const option of [shortTicker, occ, typedAsStock]) {
            assert.deepEqual(mapPlaidTransaction(transaction({ security_id: "acme_c", quantity: 2, price: 4.2, amount: 840.65 }), option), { skipped: "option" });
            assert.deepEqual(mapPlaidTransaction(transaction({ type: "sell", subtype: "sell", security_id: "acme_c", quantity: -2 }), option), { skipped: "option" });
        }
        const fee = mapPlaidTransaction(transaction({ type: "fee", subtype: "fee", security_id: "acme_c", quantity: 0, price: 0, amount: 0.65, fees: null }), occ);
        assert.ok("row" in fee);
        assert.deepEqual([fee.row.type, fee.row.symbol, fee.row.amount], ["FEE", null, 0.65]);

        const counted = accountTransactions(ACCOUNT, [
            transaction({ investment_transaction_id: "o1", security_id: "acme_c" }),
            transaction({ investment_transaction_id: "o2", security_id: "acme_c", type: "sell", subtype: "sell", quantity: -10 }),
            transaction({ investment_transaction_id: "s1" }),
        ], [occ, security("aapl")]);
        assert.deepEqual(counted.rows.map((r) => r.externalId), ["plaid:s1"]);
        assert.deepEqual(counted.skipped, { option: 2 });
    });

    test("another currency is kept; a description becomes a note the API accepts", () => {
        const cad = mapPlaidTransaction(transaction({ iso_currency_code: "CAD", name: "=HYPERLINK(<evil>)" }), security("shop"));
        assert.ok("row" in cad);
        assert.equal(cad.row.currency, "CAD");
        assert.equal(cad.row.notes, "HYPERLINK(evil)");
    });

    test("accountTransactions keeps the account's rows and counts the rest by reason", () => {
        const result = accountTransactions(ACCOUNT, [
            transaction({ investment_transaction_id: "a" }),
            transaction({ investment_transaction_id: "b", type: "transfer", subtype: "merger" }),
            transaction({ investment_transaction_id: "c", type: "cancel" }),
            transaction({ investment_transaction_id: "d", account_id: "acc_other" }),
        ], [security("aapl")]);
        assert.deepEqual(result.rows.map((r) => r.externalId), ["plaid:a"]);
        assert.deepEqual(result.skipped, { "not-recorded": 2 });
    });
});

describe("Plaid investments requests", () => {
    const config = { credentials: { clientId: "client", secret: "secret" }, environment: "sandbox" as const, accessToken: "access-sandbox-1", accountIds: [ACCOUNT] };

    test("transactions are read a page at a time until Plaid's total", async () => {
        const offsets: number[] = [];
        const fetchImpl: PlaidFetch = async (url, init) => {
            const body = JSON.parse(String(init.body));
            assert.equal(url, "https://sandbox.plaid.com/investments/transactions/get");
            assert.deepEqual([body.start_date, body.end_date, body.options.account_ids, body.options.count], ["2024-10-25", "2026-10-25", [ACCOUNT], PLAID_TRANSACTIONS_PAGE]);
            offsets.push(body.options.offset);
            const page = body.options.offset === 0 ? ["t1", "t2"] : ["t3"];
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    investment_transactions: page.map((id) => transaction({ investment_transaction_id: id })),
                    securities: [security("aapl")],
                    total_investment_transactions: 3,
                }),
            };
        };
        const result = await fetchPlaidInvestmentTransactions({ ...config, startDate: "2024-10-25", endDate: "2026-10-25", fetchImpl });
        assert.deepEqual(offsets, [0, 2]);
        assert.deepEqual(result.transactions.map((t) => t.investment_transaction_id), ["t1", "t2", "t3"]);
        assert.equal(result.securities.length, 1);
    });

    test("an empty page ends the reading, whatever the total says", async () => {
        let calls = 0;
        const fetchImpl: PlaidFetch = async () => {
            calls++;
            return { ok: true, status: 200, json: async () => ({ investment_transactions: [], securities: [], total_investment_transactions: 10 }) };
        };
        await fetchPlaidInvestmentTransactions({ ...config, startDate: "2024-10-25", endDate: "2026-10-25", fetchImpl });
        assert.equal(calls, 1);
    });

    test("Plaid's error code comes through, so a caller can tell a wait from a failure", async () => {
        const fetchImpl: PlaidFetch = async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error_type: "ITEM_ERROR", error_code: "PRODUCT_NOT_READY", error_message: "the requested product is not yet ready" }),
        });
        await assert.rejects(
            fetchPlaidInvestmentTransactions({ ...config, startDate: "2024-10-25", endDate: "2026-10-25", fetchImpl }),
            (error: unknown) => error instanceof PlaidApiError && error.errorCode === "PRODUCT_NOT_READY" && error.status === 400,
        );
    });

    test("regression: a deadline bounds each request and stops the paging", async () => {
        // The Codex finding on PR #162: the nightly budget was only checked
        // between connections, so one slow connection could take the run.
        let now = 1_000;
        const signals: (AbortSignal | null | undefined)[] = [];
        const fetchImpl: PlaidFetch = async (_url, init) => {
            signals.push(init.signal);
            now += 40_000; // each page takes 40 s
            return { ok: true, status: 200, json: async () => ({ investment_transactions: [transaction({})], securities: [], total_investment_transactions: 10 }) };
        };
        await assert.rejects(
            fetchPlaidInvestmentTransactions({ ...config, startDate: "2024-10-25", endDate: "2026-10-25", fetchImpl, deadline: 61_000, clock: () => now }),
            PlaidDeadlineError,
        );
        // Two pages fit in the minute, the third isn't asked for; each request
        // carried a cancel signal.
        assert.equal(signals.length, 2);
        assert.ok(signals.every((signal) => signal instanceof AbortSignal));
    });

    test("a request cancelled at the deadline is the deadline, not Plaid failing", async () => {
        const fetchImpl: PlaidFetch = async () => {
            throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
        };
        await assert.rejects(fetchPlaidHoldings({ ...config, fetchImpl, deadline: Date.now() + 1_000 }), PlaidDeadlineError);
        // Without a deadline, requests carry no cancel signal.
        let signal: AbortSignal | null | undefined = null;
        await fetchPlaidHoldings({ ...config, fetchImpl: async (_url, init) => { signal = init.signal; return { ok: true, status: 200, json: async () => ({ holdings: [], securities: [] }) }; } });
        assert.equal(signal, undefined);
    });

    test("regression: an option's details in a shape Atlas doesn't read leave that option out, not the sync", async () => {
        const fetchImpl: PlaidFetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                holdings: [holding("acme_c", { quantity: 300, institution_price: 4.2, institution_value: 1260, institution_price_as_of: 20261023 }), holding("aapl")],
                securities: [security("acme_c", { type: "derivative", ticker_symbol: "ACME270115C00150000", option_contract: "n/a" }), security("aapl")],
            }),
        });
        const response = await fetchPlaidHoldings({ ...config, fetchImpl });
        const result = accountHoldings(ACCOUNT, response.holdings, response.securities);
        assert.deepEqual(result.positions.map((p) => p.symbol), ["AAPL"]);
        assert.deepEqual([result.options, result.skipped], [[], [{ reason: "option", name: "acme_c Inc" }]]);
    });

    test("holdings in a shape Atlas doesn't read are refused, not half-read", async () => {
        const fetchImpl: PlaidFetch = async () => ({ ok: true, status: 200, json: async () => ({ holdings: [{ account_id: ACCOUNT }], securities: [] }) });
        await assert.rejects(fetchPlaidHoldings({ ...config, fetchImpl }), /shape Atlas doesn't read/);
    });
});
