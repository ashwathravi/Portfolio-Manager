import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTradeDate, parseTransactionsCsv, transactionTypeFor } from './transactionsCsv';

describe('transactionTypeFor', () => {
    test("reads brokers' wording", () => {
        const cases: [string, string | null][] = [
            ['Buy', 'BUY'], ['YOU BOUGHT APPLE INC (AAPL)', 'BUY'], ['Purchase', 'BUY'],
            ['Sell', 'SELL'], ['YOU SOLD', 'SELL'],
            ['Qualified Dividend', 'DIVIDEND'], ['DIVIDEND RECEIVED', 'DIVIDEND'], ['Reinvest Dividend', 'DIVIDEND'],
            ['Reinvest Shares', 'BUY'], ['REINVESTMENT APPLE INC (AAPL)', 'BUY'],
            ['Bank Interest', 'INTEREST'], ['Credit Interest', 'INTEREST'],
            ['Deposit', 'DEPOSIT'], ['Electronic Funds Transfer Received', 'DEPOSIT'], ['Contribution', 'DEPOSIT'],
            ['Withdrawal', 'WITHDRAWAL'], ['Transfer Out', 'WITHDRAWAL'],
            ['Service Fee', 'FEE'], ['Journal', null], ['', null],
        ];
        for (const [action, type] of cases) assert.equal(transactionTypeFor(action), type, action);
    });
});

describe('parseTradeDate', () => {
    test('ISO and US dates, including "as of"', () => {
        assert.equal(parseTradeDate('2026-03-05'), '2026-03-05');
        assert.equal(parseTradeDate('2026-03-05T14:30:00'), '2026-03-05');
        assert.equal(parseTradeDate('03/05/2026'), '2026-03-05');
        assert.equal(parseTradeDate('3/5/26'), '2026-03-05');
        assert.equal(parseTradeDate('03/05/2026 as of 03/04/2026'), '2026-03-05');
    });

    test('nothing else, and no impossible days', () => {
        for (const raw of ['', 'yesterday', '2026-02-30', '13/01/2026', '5 March 2026']) assert.equal(parseTradeDate(raw), null, raw);
    });
});

describe('parseTransactionsCsv', () => {
    test('a Fidelity-style history: notes above, signed amounts, a disclaimer below', () => {
        const csv = [
            'Brokerage',
            '',
            'Run Date,Action,Symbol,Security Description,Quantity,Price ($),Commission ($),Fees ($),Amount ($),Settlement Date',
            '03/05/2026,YOU BOUGHT APPLE INC (AAPL),AAPL,APPLE INC,10,180.5,,0.02,-1805.02,03/06/2026',
            '03/06/2026,YOU SOLD MICROSOFT CORP (MSFT),MSFT,MICROSOFT CORP,-2,410,,0.01,819.99,03/07/2026',
            '03/10/2026,DIVIDEND RECEIVED APPLE INC (AAPL) (Cash),AAPL,APPLE INC,,,,,2.40,',
            '03/12/2026,Electronic Funds Transfer Received (Cash),,No Description,,,,,1000,',
            '',
            '"The data and information in this spreadsheet is provided to you solely for your use"',
        ].join('\n');
        const { rows, issues, skipped } = parseTransactionsCsv(csv);
        assert.deepEqual(issues, []);
        assert.equal(skipped, 2);
        assert.deepEqual(rows.map((r) => [r.type, r.date, r.symbol, r.quantity, r.price, r.amount, r.fees]), [
            ['BUY', '2026-03-05', 'AAPL', 10, 180.5, 1805.02, 0.02],
            ['SELL', '2026-03-06', 'MSFT', 2, 410, 819.99, 0.01],
            ['DIVIDEND', '2026-03-10', 'AAPL', null, null, 2.4, null],
            ['DEPOSIT', '2026-03-12', null, null, null, 1000, null],
        ]);
        assert.equal(rows[0].notes, 'APPLE INC');
        assert.equal(rows[0].currency, 'USD');
    });

    test('a Schwab-style export: prices with $, reinvested dividends, an ID column', () => {
        const csv = [
            '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount","Transaction ID"',
            '"03/05/2026 as of 03/04/2026","Buy","VTI","VANGUARD TOTAL","5","$250.00","","-$1,250.00","T-1"',
            '"03/15/2026","Reinvest Dividend","VTI","VANGUARD TOTAL","","","","$12.00","T-2"',
            '"03/15/2026","Reinvest Shares","VTI","VANGUARD TOTAL","0.048","$250.00","","-$12.00","T-3"',
            '"Transactions Total","","","","","","","-$1,250.00",""',
        ].join('\n');
        const { rows, issues, skipped } = parseTransactionsCsv(csv);
        assert.deepEqual(issues, []);
        assert.equal(skipped, 1);
        assert.deepEqual(rows.map((r) => [r.type, r.date, r.amount, r.externalId]), [
            ['BUY', '2026-03-05', 1250, 'T-1'],
            ['DIVIDEND', '2026-03-15', 12, 'T-2'],
            ['BUY', '2026-03-15', 12, 'T-3'],
        ]);
    });

    test('a trade without a price takes the amount over the quantity', () => {
        const { rows } = parseTransactionsCsv('Date,Type,Symbol,Quantity,Amount\n2026-03-05,Buy,NVDA,4,500');
        assert.equal(rows[0].price, 125);
    });

    test('lists what it cannot read instead of guessing', () => {
        const csv = [
            'Date,Action,Symbol,Quantity,Price,Amount',
            'soon,Buy,AAPL,1,10,10',
            '2026-03-05,Journal,AAPL,1,10,10',
            '2026-03-05,Buy,NOT A TICKER,1,10,10',
            '2026-03-05,Buy,,1,10,10',
            '2026-03-05,Buy,AAPL,,10,10',
            '2026-03-05,Deposit,,,,',
            '2026-03-05,Buy,AAPL,1,10,10,extra',
        ].join('\n');
        const { rows, issues } = parseTransactionsCsv(csv);
        assert.deepEqual(rows, []);
        assert.deepEqual(issues.map((i) => i.line), [2, 3, 4, 5, 6, 7, 8]);
        assert.match(issues[0].message, /“soon” is not a date/);
        assert.match(issues[1].message, /Can't tell what “Journal” is/);
        assert.match(issues[2].message, /not a ticker/);
        assert.match(issues[3].message, /has no symbol/);
        assert.match(issues[4].message, /needs a quantity/);
        assert.match(issues[5].message, /has no amount/);
        assert.match(issues[6].message, /Expected 6 columns/);
    });

    test('needs a date and an action column, and a way to value each row', () => {
        assert.match(parseTransactionsCsv('Symbol,Quantity\nAAPL,1').issues[0].message, /No header row with a Date and an Action/);
        assert.match(parseTransactionsCsv('Date,Action,Symbol\n2026-03-05,Buy,AAPL').issues[0].message, /Add an Amount column/);
    });

    test('cleans notes of what the API refuses, and keeps other currencies', () => {
        const { rows } = parseTransactionsCsv('Date,Action,Symbol,Quantity,Price,Description,Currency\n2026-03-05,Buy,SHOP,1,100,=<b>Shopify</b>,cad');
        assert.equal(rows[0].notes, 'bShopify/b');
        assert.equal(rows[0].currency, 'CAD');
    });

    test('a byte-order mark and Windows line endings are fine', () => {
        const { rows, issues } = parseTransactionsCsv('﻿Date,Action,Symbol,Quantity,Price\r\n2026-03-05,Buy,AAPL,1,10\r\n');
        assert.deepEqual(issues, []);
        assert.equal(rows.length, 1);
    });

    // The Codex findings on PR #154.
    test('regression: a price worked out from a net amount leaves the fees out', () => {
        const csv = 'Date,Action,Symbol,Quantity,Net Amount,Fees\n2026-03-05,Buy,AAPL,10,-1001,1\n2026-03-06,Sell,AAPL,10,999,1';
        const { rows, issues } = parseTransactionsCsv(csv);
        assert.deepEqual(issues, []);
        assert.deepEqual(rows.map((r) => [r.type, r.price, r.amount, r.fees]), [['BUY', 100, 1001, 1], ['SELL', 100, 999, 1]]);
    });

    test('regression: an unreadable number is an issue, not a dropped value', () => {
        const csv = 'Date,Action,Symbol,Quantity,Price,Fees\n2026-03-05,Buy,AAPL,1,10,INVALID\n2026-03-05,Buy,AAPL,lots,10,\n2026-03-05,Buy,AAPL,1,10,--';
        const { rows, issues } = parseTransactionsCsv(csv);
        assert.deepEqual(issues.map((i) => [i.line, i.message]), [
            [2, '“INVALID” in fees is not a number.'],
            [3, '“lots” in quantity is not a number.'],
        ]);
        // "--" is an empty cell, as brokers write it.
        assert.deepEqual(rows.map((r) => r.fees), [null]);
    });

    test('regression: a file of exactly 2,000 transactions imports; 2,001 says to split it', () => {
        const header = 'Date,Action,Symbol,Quantity,Price';
        const lines = (n: number) => [header, ...Array.from({ length: n }, (_, i) => `2026-03-05,Buy,AAPL,${i + 1},10`)].join('\n');
        const exact = parseTransactionsCsv(lines(2000));
        assert.equal(exact.rows.length, 2000);
        assert.deepEqual(exact.issues, []);
        const over = parseTransactionsCsv(lines(2001));
        assert.equal(over.rows.length, 2000);
        assert.deepEqual(over.issues.map((i) => i.message), ['Only 2000 transactions can be imported at once. Split the file.']);
    });

    test('regression: a security named "... Total ..." is a transaction; a totals line is not', () => {
        const csv = [
            'Description,Date,Action,Symbol,Quantity,Price',
            'VANGUARD TOTAL STOCK MARKET ETF,2026-03-05,Buy,VTI,1,250',
            'Total,,,,,250',
        ].join('\n');
        const { rows, issues, skipped } = parseTransactionsCsv(csv);
        assert.deepEqual(issues, []);
        assert.deepEqual(rows.map((r) => r.symbol), ['VTI']);
        assert.equal(skipped, 1);
    });
});

