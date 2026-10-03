import { test, describe } from 'node:test';
import assert from 'node:assert';
import { portfolioImportSchema } from './portfolio-import';

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

    test('a zero average cost is allowed (gifted or transferred shares)', () => {
        assert.strictEqual(portfolioImportSchema.safeParse({ portfolioId: ID, rows: [{ ...row, avgCost: 0 }] }).success, true);
    });

    test('rejects duplicate symbols and oversized imports', () => {
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: [row, row] }), 'Each symbol can appear only once');
        const many = Array.from({ length: 1001 }, (_, i) => ({ ...row, symbol: `T${i}` }));
        assert.strictEqual(firstMessage({ portfolioId: ID, rows: many }), 'Import at most 1000 positions at once');
    });
});
