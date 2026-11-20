import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { manualHoldingBodySchema, manualHoldingSchema } from './manual-holding';

const ID = '0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d';
const message = (input: unknown) => {
    const r = manualHoldingSchema.safeParse(input);
    return r.success ? null : r.error.issues[0].message;
};

describe('manualHoldingSchema', () => {
    test('a name, a value and its date; units, cost and an identifier optional; money to the cent', () => {
        assert.deepEqual(manualHoldingSchema.parse({ name: ' Target 2055 Trust ', value: 10242.499, valueAsOf: '2026-11-19' }), {
            name: 'Target 2055 Trust', identifier: null, quantity: null, value: 10242.5, costBasis: null, valueAsOf: '2026-11-19',
        });
        assert.equal(manualHoldingSchema.safeParse({ name: 'Acme', identifier: '12345X678', quantity: 1, value: 0, costBasis: 5000, valueAsOf: '2026-11-19' }).success, true);
    });

    test('refuses what it can not store', () => {
        assert.equal(message({ name: '', value: 1, valueAsOf: '2026-11-19' }), 'Name the holding');
        assert.equal(message({ name: 'A', value: -1, valueAsOf: '2026-11-19' }), "Value can't be negative");
        assert.equal(message({ name: 'A', value: 1, valueAsOf: '11/19/2026' }), 'Enter the date of the value (YYYY-MM-DD)');
        assert.equal(message({ name: 'A', value: 1, quantity: 0, valueAsOf: '2026-11-19' }), 'Units must be more than 0');
        assert.equal(message({ name: 'A', value: 1, identifier: 'x'.repeat(41), valueAsOf: '2026-11-19' }), 'Identifier is too long');
        assert.equal(message({ name: '<b>', value: 1, valueAsOf: '2026-11-19' }), 'Input contains invalid characters (< or >)');
        assert.equal(manualHoldingSchema.safeParse({ name: 'A', value: 1, valueAsOf: '2026-11-19', source: 'plaid' }).success, false);
    });

    test('the body names the account', () => {
        assert.equal(manualHoldingBodySchema.safeParse({ portfolioId: ID, holding: { name: 'A', value: 1, valueAsOf: '2026-11-19' } }).success, true);
        assert.equal(manualHoldingBodySchema.safeParse({ holding: { name: 'A', value: 1, valueAsOf: '2026-11-19' } }).success, false);
    });
});
