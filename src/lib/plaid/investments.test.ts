import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    PLAID_TRANSACTIONS_PAGE,
    accountHoldings,
    accountTransactions,
    fetchPlaidHoldings,
    fetchPlaidInvestmentTransactions,
    mapPlaidTransaction,
    optionContractsHeld,
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
            externalId: "cit", name: "Target 2055 Trust", identifier: "12345X678", quantity: 130.5, value: 11092.5, costBasis: null,
        }]);
        assert.deepEqual(result.skipped, [{ reason: "no-ticker", name: "Acme Holdings" }]);
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

        // The first lot's price has no day: a later lot's day isn't its day.
        const priceWithoutDay = accountHoldings(ACCOUNT, [
            acmeHolding({ quantity: 100, institution_value: 420, cost_basis: 350 }),
            acmeHolding({ quantity: 200, institution_price: 4.3, institution_value: 860, cost_basis: 700, institution_price_as_of: "2026-10-23" }),
        ], [acmeCall()]);
        assert.deepEqual(priceWithoutDay.options, [ACME]);
    });

    test("an option with no contracts is dropped, not counted", () => {
        const result = only(acmeHolding({ quantity: 0, institution_value: 0 }));
        assert.deepEqual([result.options, result.skipped, result.optionsKept], [[], [], []]);
    });

    test("optionContractsHeld: within rounding of the value it reads, further off it doesn't, and never a fraction of a contract", () => {
        assert.deepEqual(optionContractsHeld(300, 4.2, 1260 * 1.01), { contracts: 3, perShare: 4.2 });
        assert.equal(optionContractsHeld(300, 4.2, 1260 * 1.1), null);
        assert.equal(optionContractsHeld(2.5, 4.2, 1050), null);
        assert.equal(optionContractsHeld(250, null, null), null);
        // A price of 0 is no price to check against.
        assert.deepEqual(optionContractsHeld(-500, 0, 0), { contracts: -5, perShare: null });
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
