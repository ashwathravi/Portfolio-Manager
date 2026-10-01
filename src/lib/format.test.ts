import { test, describe } from 'node:test';
import assert from 'node:assert';
import { formatPct, formatQty, formatShortDate, formatUsd } from './format';

describe('format', () => {
    test('formatUsd uses thousands separators and a true minus sign', () => {
        assert.strictEqual(formatUsd(1234.5), '$1,234.50');
        assert.strictEqual(formatUsd(-1234.5), '−$1,234.50');
        assert.strictEqual(formatUsd(1234.5, { decimals: 0 }), '$1,235');
    });

    test('formatUsd signed adds + only to positive non-zero values', () => {
        assert.strictEqual(formatUsd(10, { signed: true }), '+$10.00');
        assert.strictEqual(formatUsd(0, { signed: true }), '$0.00');
        assert.strictEqual(formatUsd(-0.001, { signed: true }), '$0.00');
    });

    test('formatUsd renders a dash for non-finite input', () => {
        assert.strictEqual(formatUsd(Number.NaN), '—');
    });

    test('formatPct handles sign, decimals, and missing values', () => {
        assert.strictEqual(formatPct(12.345), '12.3%');
        assert.strictEqual(formatPct(-2, { decimals: 2 }), '−2.00%');
        assert.strictEqual(formatPct(3, { signed: true }), '+3.0%');
        assert.strictEqual(formatPct(null), '—');
    });

    test('formatQty trims trailing zeros', () => {
        assert.strictEqual(formatQty(1500), '1,500');
        assert.strictEqual(formatQty(0.12345), '0.1235');
        assert.strictEqual(formatQty(null), '—');
    });

    test('formatShortDate formats in UTC and tolerates bad input', () => {
        assert.strictEqual(formatShortDate('2026-02-06T23:30:00Z'), 'Feb 6, 2026');
        assert.strictEqual(formatShortDate('nope'), '—');
        assert.strictEqual(formatShortDate(null), '—');
    });
});
