import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { portfolioCreateSchema, portfolioUpdateSchema } from './portfolio';

function message(schema: typeof portfolioCreateSchema | typeof portfolioUpdateSchema, input: unknown): string | undefined {
    const result = schema.safeParse(input);
    return result.success ? undefined : result.error.issues[0]?.message;
}

describe('portfolioCreateSchema', () => {
    test('accepts a name, with or without a description and cash', () => {
        assert.deepEqual(portfolioCreateSchema.parse({ name: '  Brokerage  ' }), { name: 'Brokerage' });
        assert.deepEqual(
            portfolioCreateSchema.parse({ name: 'Roth IRA', description: 'Fidelity', cashBalance: 2500.456 }),
            { name: 'Roth IRA', description: 'Fidelity', cashBalance: 2500.46 },
        );
    });

    test('a name is required and limited', () => {
        assert.equal(message(portfolioCreateSchema, {}), 'Invalid input: expected string, received undefined');
        assert.equal(message(portfolioCreateSchema, { name: '   ' }), 'Name the account');
        assert.equal(portfolioCreateSchema.safeParse({ name: 'n'.repeat(80) }).success, true);
        assert.equal(message(portfolioCreateSchema, { name: 'n'.repeat(81) }), 'Account name is too long');
        assert.equal(message(portfolioCreateSchema, { name: '<b>x</b>' }), 'Input contains invalid characters (< or >)');
        assert.equal(message(portfolioCreateSchema, { name: '=HYPERLINK()' }), 'Input cannot start with =');
    });

    test('description and cash have limits', () => {
        assert.equal(message(portfolioCreateSchema, { name: 'A', description: 'd'.repeat(501) }), 'Description is too long');
        assert.equal(portfolioCreateSchema.safeParse({ name: 'A', cashBalance: -500 }).success, true);
        assert.equal(message(portfolioCreateSchema, { name: 'A', cashBalance: 1e13 }), 'Cash is out of range');
        assert.equal(message(portfolioCreateSchema, { name: 'A', cashBalance: Number.NaN }), 'Cash must be a number');
        assert.equal(portfolioCreateSchema.safeParse({ name: 'A', cashBalance: '100' }).success, false);
    });

    test('refuses fields it does not take', () => {
        assert.equal(portfolioCreateSchema.safeParse({ name: 'A', userId: 'someone-else' }).success, false);
        assert.equal(portfolioCreateSchema.safeParse({ name: 'A', totalValue: 1 }).success, false);
    });
});

describe('portfolioUpdateSchema', () => {
    test('any of name, description and cash; an empty description clears it', () => {
        assert.deepEqual(portfolioUpdateSchema.parse({ name: 'Renamed' }), { name: 'Renamed' });
        assert.deepEqual(portfolioUpdateSchema.parse({ cashBalance: 0 }), { cashBalance: 0 });
        assert.deepEqual(portfolioUpdateSchema.parse({ description: '' }), { description: '' });
    });

    test('at least one change, and the same rules as creating', () => {
        assert.equal(message(portfolioUpdateSchema, {}), 'Change at least one of name, description or cash');
        assert.equal(message(portfolioUpdateSchema, { name: '' }), 'Name the account');
        assert.equal(portfolioUpdateSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001' }).success, false);
    });
});
