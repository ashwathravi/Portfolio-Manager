import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { figuresIn, unbackedFigures } from './figures';

describe('figuresIn (launch item i59)', () => {
    test('amounts, percentages, decimals and grouped numbers, as their values', () => {
        assert.deepEqual(
            figuresIn('Tech is 41.90% ($1,800.50), CA$1,000 in cash, a 0.85 correlation and 12,340 shares'),
            ['41.9', '1800.5', '1000', '0.85', '12340'],
        );
    });

    test('a scale word is part of the value', () => {
        assert.deepEqual(
            figuresIn('$500K, $500 million, 1.2 billion, $1.1k, 3bn and $2 trillion'),
            ['500000', '500000000', '1200000000', '1100', '3000000000', '2000000000000'],
        );
    });

    test('counts, years and dates are left alone, a word starting with a scale letter included', () => {
        assert.deepEqual(figuresIn('Your top 5 positions in 2026, 3 trades on Oct 22, 2026, 2 mega caps and 4 bets'), []);
    });
});

describe('unbackedFigures', () => {
    const sources = ['41.9%', '$1,800', '-$1,200', 'Sold 100 KO', '$500'];

    test('a figure a tool returned is backed, whatever its sign, trailing zeros or scale', () => {
        assert.deepEqual(unbackedFigures('Tech is 41.90%, worth $1.8K; you lost $1,200 and hold $500.', sources), []);
    });

    test('a rounding, a sum or a figure no tool returned is not', () => {
        assert.deepEqual(unbackedFigures('About $1.9K, or $3,000 together, up 12.5%.', sources), ['1900', '3000', '12.5']);
    });

    test('regression: a scale word makes it another figure', () => {
        assert.deepEqual(unbackedFigures('Your cash is $500K.', sources), ['500000']);
        assert.deepEqual(unbackedFigures('Your cash is $500 million.', sources), ['500000000']);
    });
});
