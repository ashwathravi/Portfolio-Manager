import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { transactionCreateSchema, transactionImportSchema, transactionRowSchema } from './transaction';

const BUY = { type: 'BUY', date: '2026-03-05', symbol: 'AAPL', quantity: 10, price: 180.5 };

function message(input: unknown): string | undefined {
    const result = transactionRowSchema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
}

describe('transactionRowSchema', () => {
    test('accepts each kind with what it needs; currency defaults to USD', () => {
        assert.equal(transactionRowSchema.parse(BUY).currency, 'USD');
        for (const row of [
            { ...BUY, type: 'SELL', fees: 1.25, notes: 'Trimmed' },
            { type: 'DIVIDEND', date: '2026-03-10', symbol: 'AAPL', amount: 2.4 },
            { type: 'DIVIDEND', date: '2026-03-10', symbol: 'VTI', quantity: 0.05, amount: 12 },
            { type: 'INTEREST', date: '2026-03-31', amount: 0.87 },
            { type: 'DEPOSIT', date: '2026-03-01', amount: 1000, currency: 'CAD' },
            { type: 'WITHDRAWAL', date: '2026-03-01', amount: 50 },
            { type: 'FEE', date: '2026-03-01', amount: 5, externalId: 'T-9' },
        ]) {
            assert.equal(transactionRowSchema.safeParse(row).success, true, JSON.stringify(row));
        }
    });

    test('each kind refuses what it lacks', () => {
        assert.equal(message({ ...BUY, symbol: undefined }), 'Buys, sells and dividends need a symbol');
        assert.equal(message({ ...BUY, price: undefined }), 'Buys and sells need a quantity and a price');
        assert.equal(message({ type: 'DIVIDEND', date: '2026-03-10', symbol: 'AAPL' }), 'Enter the amount');
        assert.equal(message({ type: 'DEPOSIT', date: '2026-03-01', amount: 0 }), 'Enter the amount');
        assert.equal(message({ type: 'DEPOSIT', date: '2026-03-01', amount: 10, quantity: 1 }), 'Only buys, sells and dividends have a quantity');
    });

    test('values, dates, currency and text have rules', () => {
        assert.match(message({ ...BUY, type: 'SWAP' }) ?? '', /^type must be one of BUY, SELL/);
        assert.equal(message({ ...BUY, date: '03/05/2026' }), 'date must be a date (YYYY-MM-DD)');
        assert.equal(message({ ...BUY, quantity: 0 }), 'quantity must be more than 0');
        assert.equal(message({ ...BUY, price: -1 }), "price can't be negative");
        assert.equal(message({ ...BUY, fees: -1 }), "fees can't be negative");
        assert.equal(message({ ...BUY, amount: 1e13 }), 'amount is out of range');
        assert.equal(message({ ...BUY, currency: 'usd' }), 'currency must be a three-letter code such as USD');
        assert.equal(message({ ...BUY, symbol: 'aapl' }) !== undefined, true);
        assert.equal(transactionRowSchema.safeParse({ ...BUY, notes: 'n'.repeat(500) }).success, true);
        assert.equal(message({ ...BUY, notes: 'n'.repeat(501) }), 'notes must be at most 500 characters');
        assert.equal(message({ ...BUY, notes: '=cmd' }), 'Input cannot start with =');
        assert.equal(message({ ...BUY, externalId: 'x'.repeat(129) }), 'externalId must be at most 128 characters');
        assert.equal(transactionRowSchema.safeParse({ ...BUY, portfolioId: 'x' }).success, false);
    });
});

describe('create and import bodies', () => {
    const portfolioId = '0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d';

    test('one transaction into an account', () => {
        assert.equal(transactionCreateSchema.safeParse({ portfolioId, transaction: BUY }).success, true);
        assert.equal(transactionCreateSchema.safeParse({ portfolioId: 'nope', transaction: BUY }).error?.issues[0]?.message, 'Choose an account');
        assert.equal(transactionCreateSchema.safeParse({ transaction: BUY }).success, false);
    });

    test('an import: 1 to 2,000 rows', () => {
        assert.equal(transactionImportSchema.safeParse({ portfolioId, rows: [BUY] }).success, true);
        assert.equal(transactionImportSchema.safeParse({ portfolioId, rows: [] }).error?.issues[0]?.message, 'Nothing to import');
        const many = Array.from({ length: 2001 }, () => BUY);
        assert.equal(transactionImportSchema.safeParse({ portfolioId, rows: many }).error?.issues[0]?.message, 'Import at most 2000 transactions at once');
    });
});
