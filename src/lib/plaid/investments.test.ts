import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    PLAID_TRANSACTIONS_PAGE,
    accountHoldings,
    accountTransactions,
    fetchPlaidHoldings,
    fetchPlaidInvestmentTransactions,
    mapPlaidTransaction,
    transactionTypeForPlaid,
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
            { reason: "no-ticker", name: "US Treasury 2030" },
            { reason: "other-currency", name: "shop Inc" },
            { reason: "other-currency", name: "btc Inc" },
            { reason: "short", name: "short Inc" },
        ]);
    });

    test("without a cost basis, a position is held at its price: no gain Plaid didn't report", () => {
        const result = accountHoldings(ACCOUNT, [holding("vti", { quantity: 4, institution_price: 250, cost_basis: null })], [security("vti")]);
        assert.deepEqual(result.positions, [{ symbol: "VTI", name: "vti Inc", quantity: 4, avgCost: 250, price: 250 }]);
        assert.deepEqual(result.costUnknown, ["VTI"]);
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
            ["transfer", "send", null],
            ["cancel", null, null],
        ];
        for (const [type, subtype, expected] of cases) assert.equal(transactionTypeForPlaid(type, subtype), expected, `${type}/${subtype}`);
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

    test("regression: what Atlas doesn't record, or can't, is left out with a reason", () => {
        assert.deepEqual(mapPlaidTransaction(transaction({ type: "transfer", subtype: "transfer" }), security("aapl")), { skipped: "not-recorded" });
        assert.deepEqual(mapPlaidTransaction(transaction({ type: "cancel", subtype: null }), security("aapl")), { skipped: "not-recorded" });
        assert.deepEqual(mapPlaidTransaction(transaction({ iso_currency_code: null, unofficial_currency_code: "BTC" }), security("btc")), { skipped: "other-currency" });
        // A trade without a price can't be recorded as one.
        assert.deepEqual(mapPlaidTransaction(transaction({ price: null }), security("aapl")), { skipped: "invalid" });
        assert.deepEqual(mapPlaidTransaction(transaction({}), security("aapl", { ticker_symbol: null })), { skipped: "no-symbol" });
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
            transaction({ investment_transaction_id: "b", type: "transfer" }),
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

    test("holdings in a shape Atlas doesn't read are refused, not half-read", async () => {
        const fetchImpl: PlaidFetch = async () => ({ ok: true, status: 200, json: async () => ({ holdings: [{ account_id: ACCOUNT }], securities: [] }) });
        await assert.rejects(fetchPlaidHoldings({ ...config, fetchImpl }), /shape Atlas doesn't read/);
    });
});
