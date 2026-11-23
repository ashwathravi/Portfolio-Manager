import { test, describe } from 'node:test';
import assert from 'node:assert';
import { latestValueDate, MAX_IMPORT_ACCOUNTS, portfolioImportSchema, portfolioMultiImportSchema } from './portfolio-import';

const row = { symbol: 'NVDA', name: 'NVIDIA', quantity: 10, avgCost: 450 };
const ID = '0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d';

const firstMessage = (input: unknown) => {
    const r = portfolioImportSchema.safeParse(input);
    return r.success ? null : r.error.issues[0].message;
};

describe('portfolioImportSchema', () => {
    test('accepts rows into an existing account or a new named one', () => {
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: ID, rows: [row] }).success, true);
        const r = portfolioImportSchema.safeParse({ newPortfolioName: '  Brokerage  ', rows: [{ ...row, name: undefined }] });
        assert.strictEqual(r.success, true);
        if (r.success) {
            assert.strictEqual(r.data.newPortfolioName, 'Brokerage');
            assert.strictEqual(r.data.rows[0].name, '');
        }
    });

    test('needs exactly one destination', () => {
        assert.strictEqual(firstMessage({ rows: [row] }), 'Choose an existing account or name a new one');
        assert.strictEqual(firstMessage({ portfolioId: ID, newPortfolioName: 'X', rows: [row] }), 'Choose an existing account or name a new one');
        assert.strictEqual(firstMessage({ portfolioId: 'not-a-uuid', rows: [row] }), 'Unknown account');
        assert.strictEqual(firstMessage({ newPortfolioName: '   ', rows: [row] }), 'Name the new account');
        assert.strictEqual(firstMessage({ newPortfolioName: 'x'.repeat(81), rows: [row] }), 'Account name is too long');
    });

    test('rejects HTML or formula text in names', () => {
        assert.strictEqual(firstMessage({ newPortfolioName: '<b>x</b>', rows: [row] }), 'Input contains invalid characters (< or >)');
        assert.strictEqual(firstMessage({ newPortfolioName: '=SUM(A1)', rows: [row] }), 'Input cannot start with =');
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [{ ...row, name: '=cmd' }] }), 'Input cannot start with =');
    });

    test('regression: rejects a NUL in a name, which Postgres can\'t store, so the import never fails as a server error', () => {
        const nul = 'Input contains an invalid character (a null character)';
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [{ ...row, name: 'NVIDIA\u0000 Corp' }] }), nul);
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [], manual: [{ name: 'Sample Collective Trust\u0000 R6', value: 12500 }] }), nul);
        assert.strictEqual(firstMessage({ newPortfolioName: 'Work\u0000place 401k', rows: [row] }), nul);
    });

    test('validates every row', () => {
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [] }), 'Nothing to import');
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [{ ...row, quantity: 0 }] }), 'Quantity must be positive');
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [{ ...row, avgCost: -1 }] }), 'Average cost cannot be negative');
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: ID, rows: [{ ...row, symbol: 'nvda' }] }).success, false);
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: ID, rows: [{ ...row, quantity: Infinity }] }).success, false);
    });

    test('takes a file of option rows alone (launch item i63), but not nothing at all', () => {
        const option = { underlying: 'AAPL', contractType: 'call', strike: 250, expiry: '2027-01-15', quantity: 3, premium: 18.2 };
        const r = portfolioImportSchema.safeParse({ portfolioId: ID, rows: [], options: [option] });
        assert.strictEqual(r.success, true);
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [], options: [] }), 'Nothing to import');
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [], options: [{ ...option, strike: 0 }] }), 'Enter a strike above 0, to at most three decimals');
        // Without options the body is as before.
        const plain = portfolioImportSchema.safeParse({ portfolioId: ID, rows: [row] });
        assert.deepStrictEqual(plain.success && plain.data.options, []);
    });

    test('regression: any well-formed account ID is taken, as the other account routes take it', () => {
        // Not an RFC version-4 ID: refused as "Unknown account" before the
        // account was even looked up.
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: 'd41d8cd9-8f00-b204-e980-0998ecf8427e', rows: [row] }).success, true);
    });

    test('a zero average cost is allowed (gifted or transferred shares)', () => {
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: ID, rows: [{ ...row, avgCost: 0 }] }).success, true);
    });

    test('rejects duplicate symbols and oversized imports', () => {
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [row, row] }), 'Each symbol can appear only once');
        const many = Array.from({ length: 1001 }, (_, i) => ({ ...row, symbol: `T${i}` }));
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: many }), 'Import at most 1000 positions at once');
    });
});

describe('portfolioMultiImportSchema', () => {
    const multiMessage = (input: unknown) => {
        const r = portfolioMultiImportSchema.safeParse(input);
        return r.success ? null : r.error.issues[0].message;
    };

    test("accepts each of a file's accounts into an existing account or a new one", () => {
        const r = portfolioMultiImportSchema.safeParse({
            accounts: [{ portfolioId: ID, rows: [row] }, { newPortfolioName: 'Roth IRA', rows: [row] }],
        });
        assert.strictEqual(r.success, true);
    });

    test('refuses two groups into one account, an empty or oversized list, and anything else in the body', () => {
        assert.strictEqual(
            multiMessage({ accounts: [{ portfolioId: ID, rows: [row] }, { portfolioId: ID, rows: [{ ...row, symbol: 'AAPL' }] }] }),
            'Two accounts in the file go to the same Atlas account. Choose a different one for each.',
        );
        assert.strictEqual(multiMessage({ accounts: [] }), 'Nothing to import');
        const many = Array.from({ length: MAX_IMPORT_ACCOUNTS + 1 }, (_, i) => ({ newPortfolioName: `A${i}`, rows: [row] }));
        assert.strictEqual(multiMessage({ accounts: many }), `Import at most ${MAX_IMPORT_ACCOUNTS} accounts at once`);
        assert.strictEqual(portfolioMultiImportSchema.safeParse({ accounts: [{ portfolioId: ID, rows: [row] }], userId: 'x' }).success, false);
        // Each group keeps the one-account rules.
        assert.strictEqual(multiMessage({ accounts: [{ rows: [row] }] }), 'Choose an existing account or name a new one');
    });
});

describe('portfolioImportSchema › holdings valued by hand', () => {
    const fund = { name: ' Target 2055 Trust ', identifier: '', quantity: 250.5, value: 12345.674, costBasis: null };
    const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

    test('rows are taken as the card takes a holding: names trimmed, an empty identifier is none, $0 allowed, money to the cent', () => {
        const r = portfolioImportSchema.safeParse({ portfolioId: ID, rows: [], manual: [fund, { name: 'Stable Value', value: 0 }] });
        assert.strictEqual(r.success, true);
        assert.deepStrictEqual(r.success && r.data.manual, [
            { name: 'Target 2055 Trust', identifier: null, quantity: 250.5, value: 12345.67, costBasis: null },
            { name: 'Stable Value', identifier: null, quantity: null, value: 0, costBasis: null },
        ]);
        // Without them the body is as before.
        const plain = portfolioImportSchema.safeParse({ portfolioId: ID, rows: [row] });
        assert.deepStrictEqual(plain.success && [plain.data.manual, plain.data.valuesAsOf], [[], undefined]);
    });

    test("refuses a negative value, units of 0, a name with nothing to find it by, and fields the card doesn't take", () => {
        const manual = (over: object) => firstMessage({ portfolioId: ID, rows: [], manual: [{ ...fund, ...over }] });
        assert.strictEqual(manual({ value: -1 }), "Value can't be negative");
        assert.strictEqual(manual({ quantity: 0 }), 'Units must be more than 0');
        assert.strictEqual(manual({ costBasis: -5 }), "Cost can't be negative");
        assert.strictEqual(manual({ name: '***' }), 'Name the holding');
        assert.strictEqual(manual({ name: '=SUM(A1)' }), 'Input cannot start with =');
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: ID, rows: [], manual: [{ ...fund, source: 'csv' }] }).success, false);
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: ID, rows: [], manual: [{ ...fund, valueAsOf: '2026-11-02' }] }).success, false);
        // An identifier is enough to find it by.
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: ID, rows: [], manual: [{ ...fund, name: '***', identifier: '99ZZ12341' }] }).success, true);
    });

    test('a body of only holdings valued by hand is something to import; one with none of anything is not', () => {
        assert.strictEqual(portfolioImportSchema.safeParse({ newPortfolioName: 'Workplace 401k', rows: [], manual: [fund] }).success, true);
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [], options: [], manual: [] }), 'Nothing to import');
    });

    test('positions and holdings valued by hand share the 1,000-row limit, in one account and across accounts', () => {
        const positions = (n: number) => Array.from({ length: n }, (_, i) => ({ ...row, symbol: `T${i}` }));
        const funds = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Fund ${i}`, value: 1 }));
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: ID, rows: positions(600), manual: funds(400) }).success, true);
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: positions(600), manual: funds(401) }), 'Import at most 1000 positions at once');
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [], manual: funds(1001) }), 'Import at most 1000 positions at once');
        const across = portfolioMultiImportSchema.safeParse({ accounts: [{ portfolioId: ID, rows: positions(500) }, { newPortfolioName: 'Workplace 401k', rows: [], manual: funds(501) }] });
        assert.strictEqual(across.success ? null : across.error.issues[0].message, 'Import at most 1000 positions at once');
    });

    test('two rows with the same key are refused, even with the identifier spaced differently', () => {
        assert.strictEqual(
            firstMessage({ portfolioId: ID, rows: [], manual: [{ name: 'A', identifier: '99ZZ12341', value: 1 }, { name: 'B', identifier: '99zz 12341', value: 2 }] }),
            'Each holding valued by hand can appear only once',
        );
        assert.strictEqual(
            firstMessage({ portfolioId: ID, rows: [], manual: [{ name: 'Target 2055 Trust', value: 1 }, { name: 'TARGET 2055 TRUST.', value: 2 }] }),
            'Each holding valued by hand can appear only once',
        );
    });

    test('valuesAsOf is optional, an ISO date from 0001-01-01, and no later than tomorrow in UTC', () => {
        assert.strictEqual(latestValueDate(new Date('2026-11-23T23:30:00Z')), '2026-11-24');
        const body = (valuesAsOf: string) => ({ portfolioId: ID, rows: [], manual: [fund], valuesAsOf });
        const latest = latestValueDate();
        assert.strictEqual(portfolioImportSchema.safeParse(body(latest)).success, true);
        assert.strictEqual(firstMessage(body(dayAfter(latest))), "The values can't be from a future date");
        assert.strictEqual(firstMessage(body('11/02/2026')), 'Enter the date of the values (YYYY-MM-DD)');
        assert.strictEqual(firstMessage(body('0000-12-31')), 'Enter the date of the values (YYYY-MM-DD)');
        const first = portfolioImportSchema.safeParse(body('0001-01-01'));
        assert.strictEqual(first.success && first.data.valuesAsOf, '0001-01-01');
    });

    test('the multi-account body stays strict, and each account carries its own holdings valued by hand and their date', () => {
        const r = portfolioMultiImportSchema.safeParse({
            accounts: [
                { portfolioId: ID, rows: [row] },
                { newPortfolioName: 'Workplace 401k', rows: [], manual: [fund], valuesAsOf: '2026-11-02' },
            ],
        });
        assert.strictEqual(r.success, true);
        assert.deepStrictEqual(r.success && r.data.accounts.map((a) => [a.manual.length, a.valuesAsOf]), [[0, undefined], [1, '2026-11-02']]);
        assert.strictEqual(portfolioMultiImportSchema.safeParse({ accounts: [{ portfolioId: ID, rows: [row] }], manual: [fund] }).success, false);
    });
});
