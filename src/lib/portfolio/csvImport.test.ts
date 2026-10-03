import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    MAX_IMPORT_ROWS,
    parseHoldingsCsv,
    parseNumber,
    planHoldingsImport,
    splitCsvLine,
    summarizePlan,
} from './csvImport';

describe('splitCsvLine', () => {
    test('honours quoted commas and escaped quotes', () => {
        assert.deepStrictEqual(splitCsvLine('AAPL,"Apple, Inc.","1,234.5"'), ['AAPL', 'Apple, Inc.', '1,234.5']);
        assert.deepStrictEqual(splitCsvLine('X,"He said ""hi""",1'), ['X', 'He said "hi"', '1']);
        assert.deepStrictEqual(splitCsvLine('a,,b'), ['a', '', 'b']);
    });
});

describe('parseNumber', () => {
    test('strips $ and separators; parentheses and minus are negative', () => {
        assert.strictEqual(parseNumber('$1,234.50'), 1234.5);
        assert.strictEqual(parseNumber('(12.5)'), -12.5);
        assert.strictEqual(parseNumber('-3'), -3);
        assert.strictEqual(parseNumber('.5'), 0.5);
    });

    test('blank, dashes, n/a, and text are null', () => {
        for (const v of ['', '--', 'n/a', 'NA', 'abc', '1.2.3', undefined]) assert.strictEqual(parseNumber(v), null, String(v));
    });
});

describe('parseHoldingsCsv', () => {
    test('reads a simple export with average cost', () => {
        const r = parseHoldingsCsv('Symbol,Quantity,Average Cost,Description\nNVDA,10,"$450.25",NVIDIA Corp\nmsft,2.5,300,Microsoft');
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows, [
            { symbol: 'NVDA', name: 'NVIDIA Corp', quantity: 10, avgCost: 450.25 },
            { symbol: 'MSFT', name: 'Microsoft', quantity: 2.5, avgCost: 300 },
        ]);
    });

    test('derives average cost from a total cost-basis column', () => {
        const r = parseHoldingsCsv('Ticker,Shares,Cost Basis Total\nAAPL,4,"$600.00"');
        assert.deepStrictEqual(r.rows, [{ symbol: 'AAPL', name: '', quantity: 4, avgCost: 150 }]);
    });

    test('finds the header below account preamble lines and skips cash and totals', () => {
        const csv = [
            'Account Name,Brokerage ****1234',
            '',
            'Symbol,Description,Quantity,Average Cost Basis',
            'SPAXX**,Money market,1000,1',
            'VTI,Vanguard Total,12,"210.10"',
            'Pending Activity,,,',
            'Account Total,,,',
            '',
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.rows.map((x) => x.symbol), ['VTI']);
        assert.deepStrictEqual(r.issues, []);
        assert.ok(r.skipped >= 3);
    });

    test('combines two lots of the same symbol at the weighted average cost', () => {
        const r = parseHoldingsCsv('Symbol,Qty,Avg Price\nAMD,10,100\nAMD,30,120');
        assert.deepStrictEqual(r.rows, [{ symbol: 'AMD', name: '', quantity: 40, avgCost: 115 }]);
    });

    test('lists bad rows by line instead of guessing', () => {
        const r = parseHoldingsCsv('Symbol,Quantity,Average Cost\nBAD TICKER,1,1\nTSLA,-2,200\nGOOG,3,\nMETA,1,400');
        assert.deepStrictEqual(r.rows.map((x) => x.symbol), ['META']);
        assert.deepStrictEqual(r.issues.map((i) => i.line), [2, 3, 4]);
        assert.match(r.issues[1].message, /quantity must be a positive number/);
        assert.match(r.issues[2].message, /missing or invalid cost/);
    });

    test('explains a missing header or cost column', () => {
        assert.match(parseHoldingsCsv('foo,bar\n1,2').issues[0].message, /No header row/);
        assert.match(parseHoldingsCsv('Symbol,Quantity\nAAPL,1').issues[0].message, /Average cost or a Cost basis/);
    });

    test('accepts a byte-order mark and Windows line endings', () => {
        const r = parseHoldingsCsv('﻿Symbol,Quantity,Average Cost\r\nBRK.B,1,400\r\n');
        assert.deepStrictEqual(r.rows.map((x) => x.symbol), ['BRK.B']);
    });

    test('stops at the row limit with a message', () => {
        const body = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `T${i},1,1`).join('\n');
        const r = parseHoldingsCsv(`Symbol,Quantity,Average Cost\n${body}`);
        assert.strictEqual(r.rows.length, MAX_IMPORT_ROWS);
        assert.match(r.issues.at(-1)?.message ?? '', /first 1000 positions/);
    });
});

describe('planHoldingsImport', () => {
    const existing = [
        { id: 'h1', symbol: 'AAPL', quantity: 10, avgCost: 150 },
        { id: 'h2', symbol: 'MSFT', quantity: 5, avgCost: 300 },
        { id: 'h3', symbol: 'KEEP', quantity: 1, avgCost: 1 },
    ];

    test('inserts new symbols, replaces changed ones, and leaves the rest alone', () => {
        const plan = planHoldingsImport(existing, [
            { symbol: 'AAPL', name: '', quantity: 12, avgCost: 155 },
            { symbol: 'MSFT', name: '', quantity: 5, avgCost: 300 },
            { symbol: 'NVDA', name: '', quantity: 1, avgCost: 450 },
        ]);
        assert.deepStrictEqual(plan.map((p) => p.kind), ['update', 'unchanged', 'insert']);
        const update = plan[0];
        assert.ok(update.kind === 'update' && update.id === 'h1' && update.before.quantity === 10);
        assert.deepStrictEqual(summarizePlan(plan), { insert: 1, update: 1, unchanged: 1 });
    });

    test('an empty account turns every row into an insert', () => {
        const plan = planHoldingsImport([], [{ symbol: 'X', name: '', quantity: 1, avgCost: 1 }]);
        assert.deepStrictEqual(summarizePlan(plan), { insert: 1, update: 0, unchanged: 0 });
    });
});
