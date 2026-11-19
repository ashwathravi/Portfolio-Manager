import { test, describe } from 'node:test';
import assert from 'node:assert';
import { MAX_IMPORT_ACCOUNTS, portfolioImportSchema, portfolioMultiImportSchema } from './portfolio-import';

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
