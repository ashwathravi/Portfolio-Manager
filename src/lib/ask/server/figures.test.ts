import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { figuresIn, unbackedFigures } from './figures';

describe('figuresIn (launch item i59)', () => {
    test('amounts, percentages, decimals and grouped numbers, as numbers', () => {
        assert.deepEqual(
            figuresIn('Tech is 41.90% ($1,800.50), CA$1,000 in cash, a 0.85 correlation and 12,340 shares'),
            ['41.9', '1800.5', '1000', '0.85', '12340'],
        );
    });

    test('counts, years and dates are left alone', () => {
        assert.deepEqual(figuresIn('Your top 5 positions in 2026, 3 trades on Oct 22, 2026'), []);
    });
});

describe('unbackedFigures', () => {
    const sources = ['41.9%', '$1,800', '-$1,200', 'Sold 100 KO'];

    test('a figure a tool returned is backed, whatever its sign or trailing zeros', () => {
        assert.deepEqual(unbackedFigures('Tech is 41.90%, worth $1,800; you lost $1,200.', sources), []);
    });

    test('a rounding, a sum or a figure no tool returned is not', () => {
        assert.deepEqual(unbackedFigures('About $1.8K, or $3,000 together, up 12.5%.', sources), ['1.8', '3000', '12.5']);
    });
});
