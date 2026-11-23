import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    countNotInFile,
    decodeCsvBytes,
    describeImportCounts,
    describeImportResult,
    describeImportTotal,
    describeLinkedAccountRefusal,
    describeManualChange,
    describeNotInFile,
    groupImportByAccount,
    isCusip,
    isSummaryLabel,
    manualImportKey,
    MAX_IMPORT_ROWS,
    parseHoldingsCsv,
    parseNumber,
    planHoldingsImport,
    planManualImport,
    readSymbolCell,
    splitCsvLine,
    summarizeManualPlan,
    summarizePlan,
    type ExistingManualHolding,
    type ManualImportRow,
} from './csvImport';

describe('splitCsvLine', () => {
    test('honours quoted commas and escaped quotes', () => {
        assert.deepStrictEqual(splitCsvLine('AAPL,"Apple, Inc.","1,234.5"'), ['AAPL', 'Apple, Inc.', '1,234.5']);
        assert.deepStrictEqual(splitCsvLine('X,"He said ""hi""",1'), ['X', 'He said "hi"', '1']);
        assert.deepStrictEqual(splitCsvLine('a,,b'), ['a', '', 'b']);
    });
    test('rejects malformed records and preserves trailing empty fields', () => {
        assert.deepStrictEqual(splitCsvLine('AAPL,"Apple\nInc",10,'), ['AAPL', 'Apple\nInc', '10', '']);
        for (const record of ['AAPL,"Apple', 'AAPL,App"le,10', 'AAPL,"Apple"oops,10', 'AAPL,10\nMSFT,20']) {
            assert.throws(() => splitCsvLine(record));
        }
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

    test('keeps quoted multiline descriptions as one holding, never a phantom row', () => {
        for (const newline of ['\n', '\r\n', '\r']) {
            const r = parseHoldingsCsv(`Symbol,Description,Quantity,Average Cost${newline}AAPL,"Apple${newline}INC,Whatever,10,100${newline}""quoted""",10,100${newline}MSFT,Microsoft,2,300`);
            assert.deepStrictEqual(r.issues, []);
            assert.deepStrictEqual(r.rows, [
                { symbol: 'AAPL', name: `Apple${newline}INC,Whatever,10,100${newline}"quoted"`, quantity: 10, avgCost: 100 },
                { symbol: 'MSFT', name: 'Microsoft', quantity: 2, avgCost: 300 },
            ]);
        }
        const simple = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost\nAAPL,"Apple\nInc",10,100');
        assert.deepStrictEqual(simple.issues, []);
        assert.strictEqual(simple.rows[0]?.symbol, 'AAPL');
    });

    test('reports malformed quoting and column counts at the record starting line', () => {
        const r = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost\nAAPL,"Apple\nInc",10,100\nBAD,"Name"oops,1,1\nMSFT,Micro"soft,1,1\nGOOG,Google,1,1,extra\nMETA,Meta,1\nNVDA,Nvidia,1,1');
        assert.deepStrictEqual(r.rows.map((r) => r.symbol), ['AAPL', 'NVDA']);
        assert.deepStrictEqual(r.issues.map((i) => i.line), [4, 5, 6, 7]);
        const unclosed = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost\nAAPL,"Apple\nINC,Whatever,10,100');
        assert.deepStrictEqual(unclosed.rows, []);
        assert.deepStrictEqual(unclosed.issues.map((i) => i.line), [2]);
        assert.match(unclosed.issues[0].message, /unterminated/i);
    });

    test('preserves CASH and prefix-like securities; cash needs export context', () => {
        const r = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost,Asset Type\nCASH,Pathward,10,100,Stock\nCASHX,Fund,20,1,Mutual Fund\nTOTALX,Security,1,1,Stock\nPENDINGX,Security,1,1,Stock\nCASH,Cash balance,100,1,Cash\nUSD,US dollars,100,1,Currency\nSPAXX**,Broker core position,100,1,\nAccount Total,,,,');
        assert.deepStrictEqual(r.rows.map((r) => r.symbol), ['CASH', 'CASHX', 'TOTALX', 'PENDINGX']);
        assert.deepStrictEqual(r.issues, []);
        assert.strictEqual(r.skipped, 4);
        const ambiguous = parseHoldingsCsv('Symbol,Quantity,Average Cost\nCASH,10,100\nCASHX,20,1\nSPAXX,30,1');
        assert.deepStrictEqual(ambiguous.rows.map((r) => r.symbol), ['CASH', 'CASHX', 'SPAXX']);
        assert.deepStrictEqual(ambiguous.issues, []);
        assert.strictEqual(ambiguous.skipped, 0);
        const balance = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost\nCASH,Cash balance,,');
        assert.strictEqual(balance.skipped, 1);
        assert.deepStrictEqual(balance.issues, []);
        const corrupt = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost\nCASH,Cash balance,oops,1');
        assert.strictEqual(corrupt.skipped, 0);
        assert.match(corrupt.issues[0].message, /quantity/);
        const security = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost,Asset Type\nCASH,Cash balance,,1,Stock');
        assert.strictEqual(security.skipped, 0);
        assert.match(security.issues[0].message, /quantity/);
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

    // Regression: blocking the import on any issue made whole broker files
    // unimportable when their summary, cash and footer rows became issues.
    test('imports a Schwab-style export: quoted cells, trailing commas, cash and total rows', () => {
        const csv = [
            '"Positions for account Individual ...123 as of 05:00 PM ET, 2026/10/13"',
            '',
            '"Symbol","Description","Quantity","Price","Market Value","Cost Basis","Security Type",',
            '"AAPL","APPLE INC","10","$250.00","$2,500.00","$1,500.00","Equity",',
            '"VTI","VANGUARD TOTAL STOCK MARKET ETF","12","$300.00","$3,600.00","$2,520.00","ETFs & Closed End Funds",',
            '"Cash & Cash Investments","--","--","--","$1,000.00","--","Cash and Money Market",',
            '"Account Total","--","--","--","$7,100.00","$4,020.00","--",',
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows, [
            { symbol: 'AAPL', name: 'APPLE INC', quantity: 10, avgCost: 150 },
            { symbol: 'VTI', name: 'VANGUARD TOTAL STOCK MARKET ETF', quantity: 12, avgCost: 210 },
        ]);
        assert.strictEqual(r.skipped, 2);
    });

    test('imports a Fidelity-style export: core position, trailing commas and footer notes', () => {
        const csv = [
            'Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total,Average Cost Basis,Type',
            'Z12345678,Individual,SPAXX**,HELD IN MONEY MARKET,,,$1000.00,,,Cash,',
            'Z12345678,Individual,AAPL,APPLE INC,10,$250.00,$2500.00,$1500.00,$150.00,Margin,',
            'Z12345678,Individual,FXAIX,FIDELITY 500 INDEX FUND,5,$200.00,$1000.00,$900.00,$180.00,Cash,',
            '',
            '"The data and information in this spreadsheet is provided to you solely for your use."',
            '"Date downloaded 10/13/2026 5:00 PM ET"',
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows.map((x) => [x.symbol, x.quantity, x.avgCost]), [['AAPL', 10, 150], ['FXAIX', 5, 180]]);
    });

    test('skips a literal Pending summary row but imports real PENDING-prefixed symbols', () => {
        const r = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost\nAAPL,Apple,10,100\nPending,,,\nPENDX,Pend Corp,5,20');
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows.map((x) => x.symbol), ['AAPL', 'PENDX']);
        assert.strictEqual(r.skipped, 1);
    });

    test('skips one-word footers outside the symbol column, even ticker-like ones', () => {
        const csv = [
            'Account Number,Account Name,Symbol,Description,Quantity,Average Cost Basis',
            'Z12345678,Individual,AAPL,APPLE INC,10,$150.00',
            'Total',
            'Disclaimer',
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows.map((x) => x.symbol), ['AAPL']);
        assert.strictEqual(r.skipped, 2);
    });

    test('a free-text note in the symbol column is skipped; a lone ticker is still an issue', () => {
        const r = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost\nAAPL,Apple,10,100\nDate downloaded 10/13/2026\nMSFT\nBRK/B\nn/a');
        assert.deepStrictEqual(r.rows.map((x) => x.symbol), ['AAPL']);
        // A class share as Schwab writes it is a ticker too; "n/a" says there's none.
        assert.deepStrictEqual(r.issues.map((i) => [i.line, i.message]), [
            [4, 'MSFT: quantity must be a positive number.'],
            [5, 'BRK.B: quantity must be a positive number.'],
        ]);
        assert.strictEqual(r.skipped, 2);
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

/** A file's bytes as an export saves them: UTF-8, or UTF-16 in either byte order, with a byte-order mark or without. */
function fileBytes(text: string, encoding: 'utf-8' | 'utf-16le' | 'utf-16be', mark: boolean): Uint8Array<ArrayBuffer> {
    const marked = mark ? `﻿${text}` : text;
    if (encoding === 'utf-8') return new Uint8Array(Buffer.from(marked, 'utf8'));
    const bytes = Buffer.from(marked, 'utf16le');
    return new Uint8Array(encoding === 'utf-16be' ? bytes.swap16() : bytes);
}

describe('decodeCsvBytes', () => {
    const csv = [
        'Symbol,Description,Quantity,Cost Basis Total,Current Value',
        'ACME,Sample 日本 Fund,10,2000.00,2900.00',
        ',Sample Fonds Équilibré,120.5,10000.00,12500.00',
    ].join('\r\n');
    const utf8 = parseHoldingsCsv(decodeCsvBytes(fileBytes(csv, 'utf-8', false)));

    test('a UTF-8 file reads as File.text() reads it, with or without a byte-order mark', () => {
        assert.deepStrictEqual(utf8.issues, []);
        assert.deepStrictEqual(utf8.rows, [{ symbol: 'ACME', name: 'Sample 日本 Fund', quantity: 10, avgCost: 200 }]);
        assert.deepStrictEqual(utf8.manual, [{ name: 'Sample Fonds Équilibré', identifier: null, quantity: 120.5, value: 12500, costBasis: 10000 }]);
        assert.deepStrictEqual(parseHoldingsCsv(decodeCsvBytes(fileBytes(csv, 'utf-8', true))), utf8);
    });

    test('regression: a UTF-16 file in either byte order, with a byte-order mark or without, reads as the same file in UTF-8', async () => {
        for (const encoding of ['utf-16le', 'utf-16be'] as const) {
            for (const mark of [true, false]) {
                const label = `${encoding}${mark ? ' with a byte-order mark' : ''}`;
                // As the import dialog reads the file chosen.
                const r = parseHoldingsCsv(decodeCsvBytes(await new Blob([fileBytes(csv, encoding, mark)]).arrayBuffer()));
                // Its letters past ASCII intact, and no comma made out of one (本 is U+672C).
                assert.deepStrictEqual(r, utf8, label);
                // So importing it again from either file finds the same holding.
                assert.strictEqual(manualImportKey(r.manual[0]), 'csv:name:sample fonds équilibré', label);
            }
        }
    });

    test('regression: a stray last byte after a UTF-16 file is dropped, not read into its last cell', () => {
        for (const encoding of ['utf-16le', 'utf-16be'] as const) {
            for (const mark of [true, false]) {
                // A newline or NUL some tool added as a single byte, after a last cell that's a number.
                for (const stray of [0x0a, 0x00]) {
                    const bytes = new Uint8Array([...fileBytes(csv, encoding, mark), stray]);
                    const label = `${encoding}${mark ? ' with a byte-order mark' : ''}, then 0x${stray.toString(16).padStart(2, '0')}`;
                    assert.deepStrictEqual(parseHoldingsCsv(decodeCsvBytes(bytes)), utf8, label);
                }
            }
        }
        // A UTF-8 file keeps its last byte.
        assert.strictEqual(decodeCsvBytes(fileBytes('Symbol,Quantity\nVTI,7', 'utf-8', false)), 'Symbol,Quantity\nVTI,7');
    });

    test('a UTF-8 file with a stray NUL stays UTF-8, and the parser drops the NUL', () => {
        const text = 'Symbol,Description,Quantity,Average Cost\nVTI,Sample Total Market\u0000 ETF,10,200';
        assert.strictEqual(decodeCsvBytes(fileBytes(text, 'utf-8', false)), text);
        assert.deepStrictEqual(parseHoldingsCsv(decodeCsvBytes(fileBytes(text, 'utf-8', false))).rows.map((row) => row.name), ['Sample Total Market ETF']);
        assert.strictEqual(decodeCsvBytes(new Uint8Array()), '');
    });
});

describe('parseHoldingsCsv › option rows (launch item i63)', () => {
    test('a Schwab export: option rows go to the ledger, premium per share from the total cost', () => {
        const csv = [
            '"Symbol","Description","Quantity","Price","Market Value","Cost Basis","Security Type",',
            '"AAPL","APPLE INC","10","$250.00","$2,500.00","$1,500.00","Equity",',
            '"AAPL 01/15/2027 250.00 C","CALL APPLE INC $250 EXP 01/15/27","3","$21.40","$6,420.00","$5,460.00","Option",',
            '"RIVN 01/15/2027 25.00 C","CALL RIVIAN AUTOMOTIVE $25 EXP 01/15/27","-2","$1.90","-$380.00","-$880.00","Option",',
            '"Account Total","--","--","--","$8,540.00","$6,080.00","--",',
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows, [{ symbol: 'AAPL', name: 'APPLE INC', quantity: 10, avgCost: 150 }]);
        assert.deepStrictEqual(r.options, [
            { underlying: 'AAPL', contractType: 'call', strike: 250, expiry: '2027-01-15', quantity: 3, premium: 18.2 },
            { underlying: 'RIVN', contractType: 'call', strike: 25, expiry: '2027-01-15', quantity: -2, premium: 4.4 },
        ]);
    });

    test('a Fidelity export: the dash-prefixed symbol, and the average cost when there is no total', () => {
        const csv = [
            'Account Number,Account Name,Symbol,Description,Quantity,Last Price,Average Cost Basis,Type',
            'Z12345678,Individual, -SPY261218P552.5,SPY DEC 18 2026 552.5 PUT,1,$9.10,$12.05,Margin,',
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows, []);
        assert.deepStrictEqual(r.options, [{ account: 'Individual', underlying: 'SPY', contractType: 'put', strike: 552.5, expiry: '2026-12-18', quantity: 1, premium: 12.05 }]);
        assert.deepStrictEqual(r.accounts, ['Individual']);
    });

    test('a row the file marks as an option is read from its description', () => {
        const csv = ['Symbol,Description,Quantity,Cost Basis,Asset Type', "AAPL,AAPL Jan 15 '27 $250 Call,3,$5460,Option"].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.rows, []);
        assert.deepStrictEqual(r.options.map((o) => [o.underlying, o.expiry, o.strike, o.premium]), [['AAPL', '2027-01-15', 250, 18.2]]);
    });

    test("regression: an option whose contract can't be read is listed, not imported as shares of its underlying", () => {
        const csv = ['Symbol,Description,Quantity,Cost Basis,Asset Type', 'AAPL,Some call,3,$5460,Option'].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.rows, []);
        assert.deepStrictEqual(r.options, []);
        assert.match(r.issues[0].message, /an option Atlas can't read the contract of/);
    });

    test('two lots of one contract the same way round combine at the weighted premium', () => {
        const csv = [
            'Symbol,Quantity,Average Cost',
            'AAPL  270115C00250000,1,10',
            'AAPL  270115C00250000,3,20',
            'MSFT  270115P00500000,-1,5',
            'MSFT  270115P00500000,-3,9',
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.options, [
            { underlying: 'AAPL', contractType: 'call', strike: 250, expiry: '2027-01-15', quantity: 4, premium: 17.5 },
            { underlying: 'MSFT', contractType: 'put', strike: 500, expiry: '2027-01-15', quantity: -4, premium: 8 },
        ]);
    });

    test("regression: bought and written lots of one contract are listed, not averaged into a premium that depends on row order", () => {
        const lots = ['AAPL  270115C00250000,2,10', 'AAPL  270115C00250000,-1,20', 'AAPL  270115C00250000,1,30'];
        for (const order of [lots, [lots[0], lots[2], lots[1]]]) {
            const r = parseHoldingsCsv(['Symbol,Quantity,Average Cost', ...order].join('\n'));
            assert.deepStrictEqual(r.issues.map((i) => i.message), ['AAPL Jan 15 2027 250 call: bought and written lots of one contract. Enter it as one net position.']);
        }
    });

    test('contracts must be a whole number; a missing cost is listed', () => {
        const csv = ['Symbol,Quantity,Average Cost', 'AAPL 01/15/2027 250 C,1.5,10', 'AAPL 01/15/2027 300 C,2,'].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.options, []);
        assert.deepStrictEqual(r.issues.map((i) => [i.line, i.message]), [
            [2, 'AAPL 2027-01-15 250 call: contracts must be a whole number other than 0.'],
            [3, 'AAPL 2027-01-15 300 call: missing or invalid cost.'],
        ]);
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

describe('parseHoldingsCsv › files covering several accounts', () => {
    test("each row keeps its account; one symbol in two accounts is two positions; groups follow the file's order", () => {
        const csv = [
            'Account Name,Symbol,Description,Quantity,Average Cost',
            'Roth IRA,VTI,VANGUARD TOTAL,10,$200',
            'Brokerage,AAPL,APPLE INC,5,$150',
            'Roth IRA,VTI,VANGUARD TOTAL,10,$220',
            'Brokerage,VTI,VANGUARD TOTAL,2,$250',
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.accounts, ['Roth IRA', 'Brokerage']);
        assert.deepStrictEqual(r.rows.map((x) => [x.account, x.symbol, x.quantity, x.avgCost]), [
            ['Roth IRA', 'VTI', 20, 210],
            ['Brokerage', 'AAPL', 5, 150],
            ['Brokerage', 'VTI', 2, 250],
        ]);
        const groups = groupImportByAccount(r);
        assert.deepStrictEqual(groups.map((g) => [g.account, g.rows.map((x) => x.symbol)]), [['Roth IRA', ['VTI']], ['Brokerage', ['AAPL', 'VTI']]]);
        // What goes to the API carries no account field.
        assert.equal('account' in groups[0].rows[0], false);
    });

    test('accounts with one name are told apart by the last four of their number; a number alone is the label', () => {
        const csv = [
            'Account Number,Account Name,Symbol,Quantity,Cost Basis Total',
            'X11112222,Individual,AAPL,1,$100',
            'Y33334444,Individual,MSFT,1,$300',
            'Z55556666,,GOOG,1,$150',
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.accounts, ['Individual ••2222', 'Individual ••4444', 'Z55556666']);
        assert.deepStrictEqual(r.rows.map((x) => x.account), ['Individual ••2222', 'Individual ••4444', 'Z55556666']);
    });

    test('regression: long names that share 80 characters stay distinct accounts, keeping their number', () => {
        const long = 'Joint Tenants With Rights Of Survivorship Brokerage Account For The Family Trust Of';
        const csv = [
            'Account Number,Account Name,Symbol,Quantity,Cost Basis Total',
            `X11112222,${long},AAPL,1,$100`,
            `Y33334444,${long},MSFT,1,$300`,
            `Z55556666,${long} Alice,GOOG,1,$150`,
            `Z77778888,${long} Bob,NVDA,1,$150`,
        ].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.equal(new Set(r.accounts).size, 4, r.accounts.join(' | '));
        for (const label of r.accounts) assert.ok(label.length <= 80, label);
        assert.ok(r.accounts[0].endsWith('••2222'), r.accounts[0]);
        assert.ok(r.accounts[1].endsWith('••4444'), r.accounts[1]);
        assert.deepStrictEqual(groupImportByAccount(r).map((g) => g.rows.map((x) => x.symbol)), [['AAPL'], ['MSFT'], ['GOOG'], ['NVDA']]);
    });

    test('a row without an account, in a file that has the column, is listed', () => {
        const csv = ['Account,Symbol,Quantity,Average Cost', 'Brokerage,AAPL,1,$100', ',MSFT,1,$300'].join('\n');
        const r = parseHoldingsCsv(csv);
        assert.deepStrictEqual(r.rows.map((x) => x.symbol), ['AAPL']);
        assert.deepStrictEqual(r.issues, [{ line: 3, message: 'MSFT: no account. Fill in the account column.' }]);
    });

    test('a one-account file has no accounts and no groups', () => {
        const r = parseHoldingsCsv(['Symbol,Quantity,Average Cost', 'AAPL,1,$100'].join('\n'));
        assert.deepStrictEqual(r.accounts, []);
        assert.deepStrictEqual(groupImportByAccount(r), []);
        assert.equal('account' in r.rows[0], false);
    });
});

describe('parseHoldingsCsv › rows with no ticker, valued by hand', () => {
    const header = 'Symbol,Description,Quantity,Cost Basis,Market Value';

    test('a fund with no symbol and a market value comes in valued by hand, apart from the positions', () => {
        const r = parseHoldingsCsv(['Symbol,Description,Quantity,Average Cost,Market Value', 'VTI,Vanguard Total,12,210.10,3600', ',Target 2055 Trust,250.5,,"$12,345.67"'].join('\n'));
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows, [{ symbol: 'VTI', name: 'Vanguard Total', quantity: 12, avgCost: 210.1 }]);
        assert.deepStrictEqual(r.manual, [{ name: 'Target 2055 Trust', identifier: null, quantity: 250.5, value: 12345.67, costBasis: null }]);
    });

    test('regression: a stray NUL in a cell is dropped, so the file imports rather than failing to store', () => {
        const r = parseHoldingsCsv([header, 'VTI,Sample Total Market\u0000 ETF,10,2000.00,2900.00', '--,Sample Collective Trust\u0000 R6,120.5,10000,12500'].join('\n'));
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows.map((row) => row.name), ['Sample Total Market ETF']);
        assert.deepStrictEqual(r.manual.map((row) => row.name), ['Sample Collective Trust R6']);
        // What the API takes: nothing in the rows is refused.
        assert.strictEqual(JSON.stringify(r).includes('\\u0000'), false);
    });

    test('a valid CUSIP in the symbol column is the identifier and the description the name; a wrong check digit stays a ticker', () => {
        const r = parseHoldingsCsv(['Symbol,Description,Quantity,Average Cost,Market Value', '99ZZ12341,Stable Value Fund,100,,"$5,000.00"', '99ZZ12342,Near Miss Corp,10,20,$300'].join('\n'));
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.manual, [{ name: 'Stable Value Fund', identifier: '99ZZ12341', quantity: 100, value: 5000, costBasis: null }]);
        assert.deepStrictEqual(r.rows, [{ symbol: '99ZZ12342', name: 'Near Miss Corp', quantity: 10, avgCost: 20 }]);
    });

    test("a plan's fund number, an ISIN and a fund's name in the symbol column are no ticker; Excel's text guard is unwrapped", () => {
        const r = parseHoldingsCsv([
            header,
            '123456782,Plan Fund A,10,1000,1500',
            'XS0000000009,,5,,700',
            'Target Retirement 2050 Trust,,,,"2,000"',
            '="000123455",Plan Fund B,1,,10',
            '"=""987654321""",Plan Fund C,1,,20',
        ].join('\n'));
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.rows, []);
        assert.deepStrictEqual(r.manual.map((m) => [m.name, m.identifier, m.value]), [
            ['Plan Fund A', '123456782', 1500],
            ['XS0000000009', 'XS0000000009', 700],
            ['Target Retirement 2050 Trust', null, 2000],
            ['Plan Fund B', '000123455', 10],
            ['Plan Fund C', '987654321', 20],
        ]);
        assert.deepStrictEqual(readSymbolCell('="123456782"'), { ticker: null, identifier: '123456782', text: null, placeholder: false });
        assert.deepStrictEqual(readSymbolCell('brk.b'), { ticker: 'BRK.B' });
        assert.deepStrictEqual(readSymbolCell(' n/a '), { ticker: null, identifier: null, text: null, placeholder: true });
    });

    test('a ticker the price store lacks stays a position in a file with a market value: only the row decides', () => {
        const r = parseHoldingsCsv(['Symbol,Description,Quantity,Average Cost,Market Value', 'ZZZQ,Unpriced Corp,5,10,$60'].join('\n'));
        assert.deepStrictEqual(r.rows, [{ symbol: 'ZZZQ', name: 'Unpriced Corp', quantity: 5, avgCost: 10 }]);
        assert.deepStrictEqual(r.manual, []);
    });

    test('regression: a class share written BRK/B (Schwab) or BRK B is the position BRK.B, with a value column or without', () => {
        // Read as a code, a Schwab file's BRK/B came in valued by hand at
        // the file's value, never moving with the market; without a value
        // column it was listed as no ticker Atlas can price.
        const schwab = parseHoldingsCsv([header, 'BRK/B,BERKSHIRE HATHAWAY INC CLASS B,10,3000,4500', 'BF/B,BROWN FORMAN CORP CLASS B,4,200,160'].join('\n'));
        assert.deepStrictEqual([schwab.rows.map((r) => r.symbol), schwab.manual, schwab.issues], [['BRK.B', 'BF.B'], [], []]);
        const noValue = parseHoldingsCsv(['Symbol,Description,Quantity,Cost Basis', 'BRK/B,BERKSHIRE HATHAWAY INC CLASS B,10,3000', 'BRK B,BERKSHIRE HATHAWAY INC CLASS B,2,800'].join('\n'));
        assert.deepStrictEqual(noValue.issues, []);
        // One position, written two ways: the lots combine.
        assert.deepStrictEqual(noValue.rows, [{ symbol: 'BRK.B', name: 'BERKSHIRE HATHAWAY INC CLASS B', quantity: 12, avgCost: 316.6667 }]);
        assert.deepStrictEqual(readSymbolCell('brk/b'), { ticker: 'BRK.B' });
        // A space counts only in capitals and before one class letter, so a
        // short fund name stays words; and N/A says there's no symbol.
        assert.deepStrictEqual(readSymbolCell('Fund A'), { ticker: null, identifier: null, text: 'Fund A', placeholder: false });
        assert.deepStrictEqual(readSymbolCell('BOND FD'), { ticker: null, identifier: null, text: 'BOND FD', placeholder: false });
        assert.deepStrictEqual(readSymbolCell('N/A'), { ticker: null, identifier: null, text: null, placeholder: true });
    });

    test('regression: the ticker NA stays a position, alone, beside a description or with a value column', () => {
        // Read as "n/a", it was skipped with nothing listed, or came in
        // valued by hand under its description.
        const alone = parseHoldingsCsv('Symbol,Quantity,Average Cost\nNA,100,2\nAAPL,1,100');
        assert.deepStrictEqual([alone.rows.map((r) => r.symbol), alone.issues, alone.skipped], [['NA', 'AAPL'], [], 0]);
        const valued = parseHoldingsCsv([header, 'NA,Nano Labs Ltd,100,200,150'].join('\n'));
        assert.deepStrictEqual([valued.rows, valued.manual, valued.issues], [[{ symbol: 'NA', name: 'Nano Labs Ltd', quantity: 100, avgCost: 2 }], [], []]);
        const described = parseHoldingsCsv('Symbol,Description,Quantity,Average Cost\nNA,Nano Labs Ltd,100,2');
        assert.deepStrictEqual([described.rows.map((r) => r.symbol), described.issues], [['NA'], []]);
        // In a name or identifier cell, NA still says there's none.
        const fund = parseHoldingsCsv(['Symbol,Description,CUSIP,Quantity,Market Value', ',Target 2055 Trust,NA,100,150', 'n/a,NA,,1,10'].join('\n'));
        assert.deepStrictEqual([fund.manual, fund.issues, fund.skipped], [[{ name: 'Target 2055 Trust', identifier: null, quantity: 100, value: 150, costBasis: null }], [], 1]);
    });

    test('each value alias is read, a CUSIP column fills the identifier, and Investment Name and Fund Name name the rows', () => {
        for (const alias of ['Current Value', 'Market Value ($)', 'Total Value', 'Value $', 'Position Value', 'Ending Balance']) {
            const r = parseHoldingsCsv([`Symbol,Fund Name,Units,Cost Basis,${alias}`, ',Plan Fund,2,,$100'].join('\n'));
            assert.deepStrictEqual(r.manual, [{ name: 'Plan Fund', identifier: null, quantity: 2, value: 100, costBasis: null }], alias);
        }
        const r = parseHoldingsCsv(['Investment Name,Symbol,CUSIP,Shares,Total Value', 'Stable Value Fund,,99zz12341,10,$500', 'Apple Inc,AAPL,12345#675,1,$250'].join('\n'));
        assert.deepStrictEqual(r.manual, [{ name: 'Stable Value Fund', identifier: '99ZZ12341', quantity: 10, value: 500, costBasis: null }]);
        // This file has no cost column, so its position waits for one.
        assert.deepStrictEqual(r.issues.map((i) => i.message), ['Add an Average cost or a Cost basis column so gains can be calculated.']);
        const named = parseHoldingsCsv(['Investment Name,Symbol,Shares,Total Cost', 'Apple Inc,AAPL,2,$300'].join('\n'));
        assert.deepStrictEqual(named.rows, [{ symbol: 'AAPL', name: 'Apple Inc', quantity: 2, avgCost: 150 }]);
    });

    test('totals, cash and category rows with no ticker are skipped, a "Total …" fund is not, and a footer needs no account', () => {
        const r = parseHoldingsCsv([
            header,
            ',Account Total,,,"$10,000"',
            ',Equities Total,,,"$5,000"',
            ',Cash & Cash Equivalents,,,$100',
            'Futures Cash,,,,$50',
            ',Mutual Funds:,,,$4000',
            ',Total Stock Market Trust,10,1000,$1200',
        ].join('\n'));
        assert.deepStrictEqual(r.issues, []);
        assert.strictEqual(r.skipped, 5);
        assert.deepStrictEqual(r.manual, [{ name: 'Total Stock Market Trust', identifier: null, quantity: 10, value: 1200, costBasis: 1000 }]);
        const multi = parseHoldingsCsv(['Account Name,Symbol,Description,Quantity,Cost Basis,Market Value', 'Workplace 401k,,Target 2055 Trust,10,,$1000', ',,Total,,,$1000', ',,Grand Total:,,,$1000'].join('\n'));
        assert.deepStrictEqual(multi.issues, []);
        assert.strictEqual(multi.skipped, 2);
        assert.deepStrictEqual(multi.manual.map((m) => [m.account, m.name]), [['Workplace 401k', 'Target 2055 Trust']]);
        for (const label of ['Subtotal', 'Sub-Total', 'Fixed Income', 'Bank Sweep', 'Cash and Money Market', 'Total*']) assert.ok(isSummaryLabel(label), label);
        for (const label of ['Total Stock Market Trust', 'Money Market Fund', 'Stable Value']) assert.ok(!isSummaryLabel(label), label);
    });

    test('Schwab-style files read as before; a Vanguard-style file brings in a fund with no symbol', () => {
        const schwab = parseHoldingsCsv([
            '"Symbol","Description","Quantity","Price","Market Value","Cost Basis","Security Type",',
            '"AAPL","APPLE INC","10","$250.00","$2,500.00","$1,500.00","Equity",',
            '"Cash & Cash Investments","--","--","--","$1,000.00","--","Cash and Money Market",',
            '"Account Total","--","--","--","$3,500.00","$1,500.00","--",',
        ].join('\n'));
        assert.deepStrictEqual([schwab.rows.length, schwab.manual, schwab.issues, schwab.skipped], [1, [], [], 2]);
        const vanguard = parseHoldingsCsv([
            'Account Number,Investment Name,Symbol,Shares,Share Price,Total Value,Total Cost',
            '12345678,VANGUARD TOTAL STOCK MKT IDX ADMIRAL,VTSAX,10.5,120.00,1260.00,1000.00',
            '12345678,Target Retirement 2055 Trust Plus,,250.5,49.28,12345.67,',
        ].join('\n'));
        assert.deepStrictEqual(vanguard.issues, []);
        assert.deepStrictEqual(vanguard.rows, [{ account: '12345678', symbol: 'VTSAX', name: 'VANGUARD TOTAL STOCK MKT IDX ADMIRAL', quantity: 10.5, avgCost: 95.2381 }]);
        assert.deepStrictEqual(vanguard.manual, [{ account: '12345678', name: 'Target Retirement 2055 Trust Plus', identifier: null, quantity: 250.5, value: 12345.67, costBasis: null }]);
    });

    test("'--' in the symbol column: with a value column the row's label and value decide; without one it is skipped as before", () => {
        const r = parseHoldingsCsv([header, '--,Stable Value Fund,,,$500', '--,Some Heading,,,'].join('\n'));
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.manual, [{ name: 'Stable Value Fund', identifier: null, quantity: null, value: 500, costBasis: null }]);
        assert.strictEqual(r.skipped, 1);
        const old = parseHoldingsCsv(['Symbol,Description,Quantity,Cost Basis', '--,Stable Value Fund,,'].join('\n'));
        assert.deepStrictEqual([old.issues, old.manual, old.skipped], [[], [], 1]);
    });

    test("bad values are listed with the row's label; zero or blank units are unknown; an explicit $0 is kept", () => {
        const r = parseHoldingsCsv([
            header,
            ',Fund A,10,,',
            ',Fund B,10,,-5',
            ',Fund C,-1,,10',
            ',Fund D,1,-3,10',
            ',Fund E,1,,2000000000000',
            ',Fund F,0,,10',
            ',Fund G,,,0',
        ].join('\n'));
        assert.deepStrictEqual(r.issues, [
            { line: 2, message: 'Fund A: no ticker and no value. Fill in its market value, or add it on Holdings.' },
            { line: 3, message: "Fund B: value can't be negative." },
            { line: 4, message: "Fund C: units can't be negative." },
            { line: 5, message: "Fund D: cost can't be negative." },
            { line: 6, message: 'Fund E: value is out of range.' },
        ]);
        assert.deepStrictEqual(r.manual, [
            { name: 'Fund F', identifier: null, quantity: null, value: 10, costBasis: null },
            { name: 'Fund G', identifier: null, quantity: null, value: 0, costBasis: null },
        ]);
    });

    test('without a value column, a row with no ticker says how to bring it in, on its own line', () => {
        const r = parseHoldingsCsv(['Symbol,Description,Quantity,Average Cost', 'BAD TICKER,Nope,1,1', ',Target 2055 Trust,250.5,', 'META,Meta,1,400'].join('\n'));
        assert.deepStrictEqual(r.rows.map((x) => x.symbol), ['META']);
        assert.deepStrictEqual(r.issues, [
            { line: 2, message: "“BAD TICKER” isn't a ticker Atlas can price. Add a market value column to bring it in valued by hand, or add it on Holdings." },
            { line: 3, message: 'Target 2055 Trust: no ticker. Add a market value column to bring it in valued by hand, or add it on Holdings.' },
        ]);
    });

    test('names: < or > or a leading = is listed, a long name is cut, and a code over 40 characters is the name', () => {
        const long = 'Long fund name '.repeat(10).trim();
        const r = parseHoldingsCsv([header, ',<b>Fund</b>,1,,10', ',=HYPERLINK(x),1,,10', `,${long},1,,10`, `${'A'.repeat(41)},,1,,10`, ',***,1,,10'].join('\n'));
        assert.deepStrictEqual(r.issues, [
            { line: 2, message: "<b>Fund</b>: the name can't contain < or > or start with =." },
            { line: 3, message: "=HYPERLINK(x): the name can't contain < or > or start with =." },
            { line: 6, message: '***: the name needs a letter or a digit.' },
        ]);
        assert.deepStrictEqual(r.manual.map((m) => [m.name, m.identifier]), [[long.slice(0, 120).trimEnd(), null], ['A'.repeat(41), null]]);
        assert.ok(r.manual[0].name.length <= 120);
    });

    test('two lines of one fund in one account combine; the same fund in two accounts stays two rows', () => {
        const r = parseHoldingsCsv([
            'Account Name,Symbol,Description,Quantity,Cost Basis,Market Value',
            'Workplace 401k,,Target 2055 Trust,10,800,1000',
            'Workplace 401k,,TARGET 2055 TRUST,5,400,500',
            'Workplace 401k,,Stable Value,10,,100.10',
            'Workplace 401k,,Stable Value,5,50,50.20',
            'IRA,,Target 2055 Trust,1,,100',
        ].join('\n'));
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.manual, [
            { account: 'Workplace 401k', name: 'Target 2055 Trust', identifier: null, quantity: 15, value: 1500, costBasis: 1200 },
            { account: 'Workplace 401k', name: 'Stable Value', identifier: null, quantity: 15, value: 150.3, costBasis: null },
            { account: 'IRA', name: 'Target 2055 Trust', identifier: null, quantity: 1, value: 100, costBasis: null },
        ]);
    });

    test('positions and holdings valued by hand share the row limit', () => {
        const tickers = Array.from({ length: 500 }, (_, i) => `T${i},Ticker ${i},1,1,1`);
        const funds = Array.from({ length: 505 }, (_, i) => `,Fund ${i},1,,1`);
        const r = parseHoldingsCsv([header, ...tickers, ...funds].join('\n'));
        assert.strictEqual(r.rows.length + r.manual.length, MAX_IMPORT_ROWS);
        assert.strictEqual(r.manual.length, 500);
        assert.match(r.issues.at(-1)?.message ?? '', /first 1000 positions/);
    });

    test('a value column without a cost column: holdings valued by hand are read, positions wait for the cost column', () => {
        const r = parseHoldingsCsv(['Positions as of today', 'Symbol,Description,Quantity,Market Value', 'AAPL,Apple,10,2500', 'MSFT,Microsoft,5,2000', ',Target 2055 Trust,10,1000'].join('\n'));
        assert.deepStrictEqual(r.issues, [{ line: 2, message: 'Add an Average cost or a Cost basis column so gains can be calculated.' }]);
        assert.deepStrictEqual(r.rows, []);
        assert.deepStrictEqual(r.manual.map((m) => m.name), ['Target 2055 Trust']);
        const onlyHandValued = parseHoldingsCsv(['Symbol,Description,Quantity,Market Value', ',Target 2055 Trust,10,1000'].join('\n'));
        assert.deepStrictEqual([onlyHandValued.issues, onlyHandValued.manual.length], [[], 1]);
        const neither = parseHoldingsCsv(['Symbol,Description,Quantity', ',Target 2055 Trust,10'].join('\n'));
        assert.deepStrictEqual([neither.issues.map((i) => i.line), neither.manual], [[1], []]);
        assert.match(neither.issues[0].message, /Average cost or a Cost basis/);
    });

    test("groupImportByAccount puts each account's holdings valued by hand in its group, and keeps a group of only those", () => {
        const r = parseHoldingsCsv(['Account Name,Symbol,Description,Quantity,Cost Basis,Market Value', 'Brokerage,AAPL,Apple,10,1500,2500', 'Workplace 401k,,Target 2055 Trust,10,,1000'].join('\n'));
        const groups = groupImportByAccount(r);
        assert.deepStrictEqual(groups.map((g) => [g.account, g.rows.length, g.manual.length]), [['Brokerage', 1, 0], ['Workplace 401k', 0, 1]]);
        assert.deepStrictEqual(groups[1].manual, [{ name: 'Target 2055 Trust', identifier: null, quantity: 10, value: 1000, costBasis: null }]);
        // A result without hand-valued rows still groups.
        assert.deepStrictEqual(groupImportByAccount({ rows: r.rows, options: [], accounts: r.accounts }).map((g) => g.manual), [[]]);
    });

    test('an account number guarded as text (="0123") is read without the guard', () => {
        const r = parseHoldingsCsv(['Account Number,Symbol,Quantity,Average Cost', '="00012345",AAPL,1,100'].join('\n'));
        assert.deepStrictEqual(r.issues, []);
        assert.deepStrictEqual(r.accounts, ['00012345']);
    });
});

describe('manualImportKey and isCusip', () => {
    test('the identifier first, ignoring spaces and case; else the name, ignoring case, punctuation and spacing', () => {
        assert.strictEqual(manualImportKey({ name: 'Anything', identifier: ' 99zz 12341 ' }), 'csv:id:99ZZ12341');
        assert.strictEqual(manualImportKey({ name: 'Target  2055 — Trust!', identifier: null }), 'csv:name:target 2055 trust');
        assert.strictEqual(manualImportKey({ name: 'TARGET 2055 TRUST', identifier: '' }), 'csv:name:target 2055 trust');
        assert.strictEqual(manualImportKey({ name: 'ＴＡＲＧＥＴ 2055 Trust' }), 'csv:name:target 2055 trust');
        assert.strictEqual(manualImportKey({ name: '***', identifier: null }), null);
    });

    test('isCusip checks the check digit and the length', () => {
        for (const code of ['99ZZ12341', '123456782', '99zz12341', '12345#675']) assert.ok(isCusip(code), code);
        for (const code of ['99ZZ12342', '99ZZ1234', '99ZZ123410', '99ZZ1234A', '']) assert.ok(!isCusip(code), code);
    });
});

describe('planManualImport', () => {
    const saved = (over: Partial<ExistingManualHolding> & Pick<ExistingManualHolding, 'id' | 'name'>): ExistingManualHolding => ({
        identifier: null, importKey: null, quantity: null, value: 0, costBasis: null, valueAsOf: '2026-11-01', ...over,
    });
    const row = (over: Partial<ManualImportRow> & Pick<ManualImportRow, 'name' | 'value'>): ManualImportRow => ({ identifier: null, quantity: null, costBasis: null, ...over });
    const trust = saved({ id: 'm1', name: 'Target 2055 Trust', importKey: 'csv:name:target 2055 trust', quantity: 10, value: 1000, costBasis: 800 });
    const asOf = '2026-11-02';

    test('the same key updates it; a units or cost change changes the holding, a new value alone does not', () => {
        const [units] = planManualImport([trust], [row({ name: 'Target 2055 Trust', quantity: 12, value: 1300 })], { asOf });
        assert.deepStrictEqual(units, {
            kind: 'update', id: 'm1', key: 'csv:name:target 2055 trust', row: row({ name: 'Target 2055 Trust', quantity: 12, value: 1300 }),
            savedName: 'Target 2055 Trust', savedValueAsOf: '2026-11-01', olderThanSaved: false, changesHolding: true, replacesPosition: null,
        });
        const [cost] = planManualImport([trust], [row({ name: 'Target 2055 Trust', quantity: 10, value: 1000, costBasis: 900 })], { asOf });
        assert.deepStrictEqual([cost.kind, cost.kind !== 'insert' && cost.changesHolding], ['update', true]);
        // Without a cost in the file, the saved cost stands.
        const [price] = planManualImport([trust], [row({ name: 'Target 2055 Trust', quantity: 10, value: 1100 })], { asOf });
        assert.deepStrictEqual([price.kind, price.kind !== 'insert' && price.changesHolding], ['update', false]);
        const [same] = planManualImport([trust], [row({ name: 'target 2055 trust', quantity: 10, value: 1000.001 })], { asOf });
        assert.strictEqual(same.kind, 'unchanged');
    });

    test('the same identifier finds a renamed holding; the same name finds one added by hand, unless their identifiers differ', () => {
        const stable = saved({ id: 'm2', name: 'Stable Value Fund', identifier: '99ZZ12341', value: 500 });
        const company = saved({ id: 'm3', name: 'Company Stock Fund', quantity: 5, value: 200 });
        const bond = saved({ id: 'm4', name: 'Bond Fund', identifier: 'AAA111', value: 50 });
        const plan = planManualImport([stable, company, bond], [
            row({ name: 'Stable Value Fund II', identifier: '99zz 12341', value: 550 }),
            row({ name: 'COMPANY STOCK FUND', identifier: 'XYZ123', quantity: 5, value: 210 }),
            row({ name: 'Bond Fund', identifier: 'BBB222', value: 60 }),
        ], { asOf });
        assert.deepStrictEqual(plan.map((p) => [p.kind, p.kind === 'insert' ? null : p.id, p.kind === 'insert' ? null : p.savedName]), [
            ['update', 'm2', 'Stable Value Fund'],
            ['update', 'm3', 'Company Stock Fund'],
            ['insert', null, null],
        ]);
    });

    test('each holding is claimed once, and each tier runs over the whole file before the next', () => {
        const h = saved({ id: 'h', name: 'Stable Value Fund', identifier: '99ZZ12341', importKey: 'csv:name:stable value fund', value: 500 });
        // The first row would find it by identifier, but the second has its key.
        const plan = planManualImport([h], [row({ name: 'Other Name', identifier: '99ZZ12341', value: 1 }), row({ name: 'Stable Value Fund', value: 2 })], { asOf });
        assert.deepStrictEqual(plan.map((p) => [p.kind, p.kind === 'insert' ? null : p.id]), [['insert', null], ['update', 'h']]);
        const twice = planManualImport([trust], [row({ name: 'Target 2055 Trust', identifier: 'A1', value: 1 }), row({ name: 'Target 2055 Trust', identifier: 'B2', value: 2 })], { asOf });
        assert.deepStrictEqual(twice.map((p) => p.kind), ['update', 'insert']);
    });

    test("a file older than the saved value is unchanged and changes nothing but that day's history", () => {
        const [older] = planManualImport([trust], [row({ name: 'Target 2055 Trust', quantity: 99, value: 5 })], { asOf: '2026-10-20' });
        assert.deepStrictEqual(older.kind === 'unchanged' && [older.olderThanSaved, older.changesHolding, older.savedValueAsOf], [true, false, '2026-11-01']);
        const [sameDay] = planManualImport([trust], [row({ name: 'Target 2055 Trust', quantity: 10, value: 5 })], { asOf: '2026-11-01' });
        assert.deepStrictEqual(sameDay.kind === 'update' && sameDay.olderThanSaved, false);
    });

    test('a row whose code is held as a position replaces it, once; summarizeManualPlan counts it all', () => {
        const plan = planManualImport([trust], [
            row({ name: 'Stable Value Fund', identifier: '99ZZ12341', value: 500 }),
            row({ name: 'Plan Fund', identifier: '123456782', value: 10 }),
            row({ name: 'Target 2055 Trust', quantity: 10, value: 1000 }),
            row({ name: 'Bond Fund', identifier: 'XS0000000009', value: 5 }),
        ], { asOf, positions: ['99zz12341', 'AAPL', 'XS0000000009'] });
        assert.deepStrictEqual(plan.map((p) => p.replacesPosition), ['99ZZ12341', null, null, null]);
        assert.deepStrictEqual(summarizeManualPlan(plan), { insert: 3, update: 0, unchanged: 1, replacedPositions: 1 });
        assert.deepStrictEqual(summarizeManualPlan([]), { insert: 0, update: 0, unchanged: 0, replacedPositions: 0 });
    });
});

describe('describeImportCounts', () => {
    test('reads as before without holdings valued by hand, and names them when there are some', () => {
        const cases: [Parameters<typeof describeImportCounts>[0], string][] = [
            [{ positions: 2, handValued: 0, options: 0, accounts: 0 }, '2 positions'],
            [{ positions: 2, handValued: 0, options: 0, accounts: 2 }, '2 positions in 2 accounts'],
            [{ positions: 1, handValued: 0, options: 1, accounts: 1 }, '1 position and 1 option position'],
            [{ positions: 0, handValued: 0, options: 2, accounts: 0 }, '0 positions and 2 option positions'],
            [{ positions: 1, handValued: 2, options: 0, accounts: 0 }, '1 position and 2 valued by hand'],
            [{ positions: 2, handValued: 1, options: 1, accounts: 2 }, '2 positions in 2 accounts, 1 valued by hand and 1 option position'],
            [{ positions: 0, handValued: 1, options: 0, accounts: 0 }, '1 holding valued by hand'],
            [{ positions: 0, handValued: 2, options: 1, accounts: 0 }, '2 holdings valued by hand and 1 option position'],
            [{ positions: 0, handValued: 2, options: 0, accounts: 2 }, '2 holdings valued by hand in 2 accounts'],
        ];
        for (const [counts, text] of cases) assert.strictEqual(describeImportCounts(counts), text);
    });
});

describe('describeManualChange', () => {
    const saved = (over: Partial<ExistingManualHolding> & Pick<ExistingManualHolding, 'id' | 'name'>): ExistingManualHolding => ({
        identifier: null, importKey: null, quantity: null, value: 0, costBasis: null, valueAsOf: '2026-11-01', ...over,
    });
    const row = (over: Partial<ManualImportRow> & Pick<ManualImportRow, 'name' | 'value'>): ManualImportRow => ({ identifier: null, quantity: null, costBasis: null, ...over });
    const trust = saved({ id: 'm1', name: 'Target 2055 Trust', importKey: 'csv:name:target 2055 trust', quantity: 10, value: 1000 });
    const stable = saved({ id: 'm2', name: 'Stable Value Fund', identifier: '99ZZ12341', value: 500 });

    test("says what each row does to the holding it finds, naming the holding when the file calls it something else", () => {
        const plan = planManualImport([trust, stable], [
            row({ name: 'Target 2055 Trust ', quantity: 12, value: 1300 }),
            row({ name: 'Stable Value Fund II', identifier: '99ZZ12341', value: 550 }),
            row({ name: 'Bond Fund', value: 60 }),
        ], { asOf: '2026-11-02' });
        assert.deepStrictEqual(plan.map(describeManualChange), ['Updates', 'Updates “Stable Value Fund”', 'New']);
        const [same] = planManualImport([trust], [row({ name: 'Target 2055 Trust', quantity: 10, value: 1000 })], { asOf: '2026-11-02' });
        assert.strictEqual(describeManualChange(same), 'No change');
    });

    test("a file older than the saved value keeps it, with the saved day; a row that takes a position's place says which", () => {
        const [older] = planManualImport([trust], [row({ name: 'Target 2055 Trust', quantity: 12, value: 5 })], { asOf: '2026-10-20' });
        assert.strictEqual(describeManualChange(older), 'Keeps the newer value from Nov 1, 2026');
        const plan = planManualImport([stable], [
            row({ name: 'Plan Fund', identifier: '123456782', value: 10 }),
            row({ name: 'Stable Value Fund', identifier: '99ZZ12341', value: 550 }),
        ], { asOf: '2026-11-02', positions: ['123456782', '99ZZ12341'] });
        assert.deepStrictEqual(plan.map(describeManualChange), ['New, replaces position 123456782', 'Updates, replaces position 99ZZ12341']);
    });
});

describe('countNotInFile and describeNotInFile', () => {
    const existing = [
        { id: 'm1', importKey: 'csv:name:target 2055 trust', portfolioId: 'acct-1' },
        { id: 'm2', importKey: 'csv:id:99ZZ12341', portfolioId: 'acct-1' },
        { id: 'm3', importKey: null, portfolioId: 'acct-1' },
        { id: 'm4', importKey: 'csv:name:bond fund', portfolioId: 'acct-2' },
    ];
    const held = existing.map((h) => ({ ...h, name: h.id, identifier: null, quantity: null, value: 1, costBasis: null, valueAsOf: '2026-11-01' }));

    test("counts an account's holdings an earlier file brought in that this plan leaves out, never one added by hand", () => {
        const plan = planManualImport(held, [{ name: 'Target 2055 Trust', identifier: null, quantity: null, value: 2, costBasis: null }], { asOf: '2026-11-02' });
        assert.strictEqual(plan[0].kind === 'update' && plan[0].id, 'm1');
        assert.strictEqual(countNotInFile(existing, plan, 'acct-1'), 1);
        assert.strictEqual(countNotInFile(existing, plan, 'acct-2'), 1);
        assert.strictEqual(countNotInFile(existing, [], 'acct-1'), 2);
        assert.strictEqual(countNotInFile(existing, [], 'acct-3'), 0);
    });

    test('says they stay, in the singular or the plural', () => {
        assert.strictEqual(
            describeNotInFile('Brokerage', 1),
            "1 holding valued by hand that an earlier file brought into Brokerage isn't in this one. It stays as it is; delete it on Holdings if it's gone.",
        );
        assert.strictEqual(
            describeNotInFile('Brokerage', 2),
            "2 holdings valued by hand that an earlier file brought into Brokerage aren't in this one. They stay as they are; delete them on Holdings if they're gone.",
        );
    });
});

describe('describeLinkedAccountRefusal', () => {
    test('says the account is linked and its holdings without a ticker come with each sync, never that it is linked to a bank', () => {
        assert.strictEqual(
            describeLinkedAccountRefusal('Brokerage Link'),
            'Brokerage Link is a linked account, so its holdings without a ticker come in with each sync. Import this file into another account.',
        );
    });
});

describe('describeImportTotal and describeImportResult', () => {
    const none = { insert: 0, update: 0, unchanged: 0 };

    test('the button counts positions, or holdings once some are valued by hand', () => {
        assert.strictEqual(describeImportTotal({ positions: 1, handValued: 0 }), '1 position');
        assert.strictEqual(describeImportTotal({ positions: 3, handValued: 0 }), '3 positions');
        assert.strictEqual(describeImportTotal({ positions: 0, handValued: 1 }), '1 holding');
        assert.strictEqual(describeImportTotal({ positions: 1, handValued: 2 }), '3 holdings');
    });

    test('reads as before without holdings valued by hand', () => {
        assert.strictEqual(
            describeImportResult({ positions: 2, options: 0, handValued: 0, accounts: 1 }, { positions: { insert: 1, update: 1, unchanged: 0 }, options: none, handValued: { ...none, replacedPositions: 0 } }),
            'Imported 2 positions: 1 new, 1 updated.',
        );
        assert.strictEqual(
            describeImportResult(
                { positions: 2, options: 1, handValued: 0, accounts: 2 },
                { positions: { insert: 1, update: 0, unchanged: 1 }, options: { insert: 1, update: 0, unchanged: 0 }, handValued: { ...none, replacedPositions: 0 } },
            ),
            'Imported 3 positions across 2 accounts: 1 new, 0 updated, 1 unchanged. Option positions: 1 new, 0 updated.',
        );
    });

    test('holdings valued by hand are counted apart from the positions, and alone when the file has no positions', () => {
        assert.strictEqual(
            describeImportResult({ positions: 1, options: 0, handValued: 2, accounts: 1 }, { positions: { insert: 1, update: 0, unchanged: 0 }, options: none, handValued: { insert: 2, update: 0, unchanged: 0, replacedPositions: 0 } }),
            'Imported 1 position: 1 new, 0 updated. Valued by hand: 2 new, 0 updated.',
        );
        assert.strictEqual(
            describeImportResult({ positions: 0, options: 0, handValued: 1, accounts: 1 }, { positions: none, options: none, handValued: { insert: 1, update: 0, unchanged: 0, replacedPositions: 0 } }),
            'Imported 1 holding valued by hand: 1 new, 0 updated.',
        );
        assert.strictEqual(
            describeImportResult({ positions: 0, options: 0, handValued: 3, accounts: 2 }, { positions: none, options: none, handValued: { insert: 2, update: 1, unchanged: 0, replacedPositions: 1 } }),
            "Imported 3 holdings valued by hand across 2 accounts: 2 new, 1 updated; 1 replaces a position Atlas couldn't price.",
        );
        assert.strictEqual(
            describeImportResult(
                { positions: 1, options: 1, handValued: 3, accounts: 1 },
                { positions: { insert: 0, update: 1, unchanged: 0 }, options: { insert: 1, update: 0, unchanged: 0 }, handValued: { insert: 1, update: 1, unchanged: 1, replacedPositions: 2 } },
            ),
            "Imported 2 positions: 0 new, 1 updated. Option positions: 1 new, 0 updated. Valued by hand: 1 new, 1 updated, 1 unchanged; 2 replace positions Atlas couldn't price.",
        );
    });
});
