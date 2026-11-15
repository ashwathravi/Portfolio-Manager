import { test, describe } from 'node:test';
import assert from 'node:assert';
import { compare, describeRule } from './evaluator';

describe('compare', () => {
    test('gte / lte / gt / lt / eq semantics', () => {
        assert.strictEqual(compare(5, 'gte', 5), true);
        assert.strictEqual(compare(4, 'gte', 5), false);
        assert.strictEqual(compare(5, 'lte', 5), true);
        assert.strictEqual(compare(6, 'lte', 5), false);
        assert.strictEqual(compare(6, 'gt', 5), true);
        assert.strictEqual(compare(5, 'gt', 5), false);
        assert.strictEqual(compare(4, 'lt', 5), true);
        assert.strictEqual(compare(5, 'lt', 5), false);
        assert.strictEqual(compare(5, 'eq', 5), true);
        assert.strictEqual(compare(5.0000001, 'eq', 5), true);
        assert.strictEqual(compare(5.01, 'eq', 5), false);
    });
});

describe('describeRule', () => {
    test('renders a symbol price rule', () => {
        assert.strictEqual(
            describeRule({ metric: 'price', symbol: 'aapl', comparator: 'gte', threshold: 150 }),
            'AAPL price ≥ $150',
        );
    });

    test('renders a percentage rule with sign', () => {
        assert.strictEqual(
            describeRule({ metric: 'price_change_pct', symbol: 'TSLA', comparator: 'lte', threshold: -0.05 }),
            'TSLA daily % change ≤ -5.00%',
        );
    });

    test('renders a portfolio rule without symbol', () => {
        assert.strictEqual(
            describeRule({ metric: 'portfolio_value', comparator: 'lt', threshold: 100000 }),
            'Portfolio value < $100,000',
        );
    });

    test('renders an Alpha Radar materiality score rule', () => {
        assert.strictEqual(
            describeRule({ metric: 'alpha_radar_user_overlap', comparator: 'gte', threshold: 80 }),
            'Alpha Radar user-overlap score ≥ 80/100',
        );
    });
});
