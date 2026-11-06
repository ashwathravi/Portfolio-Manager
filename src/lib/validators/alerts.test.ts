import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { alertNotificationsReadSchema, alertRuleInputSchema, alertRuleSchema, needsSymbol } from './alerts';

const priceRule = {
    name: 'AAPL above $200',
    metric: 'price' as const,
    symbol: 'aapl',
    comparator: 'gte' as const,
    threshold: 200,
    enabled: true,
    rearm: 'daily' as const,
    note: 'Trim if it holds',
};

function firstIssue(result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) {
    assert.equal(result.success, false);
    return result.error!.issues[0];
}

describe('alertRuleInputSchema (launch item i57)', () => {
    test('accepts a price rule, upper-casing the symbol', () => {
        const result = alertRuleInputSchema.safeParse(priceRule);
        assert.equal(result.success, true);
        assert.deepEqual(result.data, { ...priceRule, symbol: 'AAPL' });
    });

    test('drops the symbol of a metric that has none, and an empty note', () => {
        const result = alertRuleInputSchema.safeParse({ ...priceRule, metric: 'portfolio_value', threshold: 100000, symbol: 'AAPL', note: '' });
        assert.equal(result.success, true);
        assert.equal(result.data?.symbol, null);
        assert.equal(result.data?.note, null);
        const noSymbol = alertRuleInputSchema.safeParse({ name: 'Value', metric: 'portfolio_value', comparator: 'lt', threshold: 1, enabled: true, rearm: 'once' });
        assert.equal(noSymbol.success, true);
        assert.equal(noSymbol.data?.note, null);
    });

    test('needs a symbol for a price or daily-change rule', () => {
        for (const metric of ['price', 'price_change_pct'] as const) {
            const issue = firstIssue(alertRuleInputSchema.safeParse({ ...priceRule, symbol: undefined, metric, threshold: 0.05 }));
            assert.equal(issue.message, 'Symbol is required for this metric');
            assert.deepEqual(issue.path, ['symbol']);
            assert.equal(needsSymbol(metric), true);
        }
        assert.equal(needsSymbol('portfolio_value'), false);
    });

    test('refuses fields the rule doesn\'t have', () => {
        const issue = firstIssue(alertRuleInputSchema.safeParse({ ...priceRule, userId: 'someone-else' }));
        assert.match(issue.message, /userId/);
    });

    test('names, symbols and notes stop at their limits', () => {
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...priceRule, name: ' ' })).message, 'Name is required');
        assert.equal(alertRuleInputSchema.safeParse({ ...priceRule, name: 'x'.repeat(60) }).success, true);
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...priceRule, name: 'x'.repeat(61) })).message, 'Name is too long');
        assert.equal(alertRuleInputSchema.safeParse({ ...priceRule, symbol: 'BRK.B' }).success, true);
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...priceRule, symbol: 'ABCDEFGHIJK' })).message, 'Symbol is too long');
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...priceRule, symbol: 'A$PL' })).message, 'Invalid symbol');
        assert.equal(alertRuleInputSchema.safeParse({ ...priceRule, note: 'n'.repeat(200) }).success, true);
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...priceRule, note: 'n'.repeat(201) })).message, 'Note is too long');
    });

    test('a dollar threshold can\'t be negative', () => {
        assert.equal(alertRuleInputSchema.safeParse({ ...priceRule, threshold: 0 }).success, true);
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...priceRule, threshold: -1 })).message, "Threshold can't be negative");
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...priceRule, metric: 'portfolio_value', threshold: -1 })).message, "Threshold can't be negative");
    });

    test('a daily change is a fraction between -1 and 10', () => {
        const change = { ...priceRule, metric: 'price_change_pct' as const };
        assert.equal(alertRuleInputSchema.safeParse({ ...change, threshold: -1 }).success, true);
        assert.equal(alertRuleInputSchema.safeParse({ ...change, threshold: 10 }).success, true);
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...change, threshold: -1.01 })).message, 'Use a fraction between -1 and 10 (0.05 = 5%)');
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...change, metric: 'portfolio_day_change_pct', threshold: 11 })).message, 'Use a fraction between -1 and 10 (0.05 = 5%)');
    });

    test('an Alpha Radar score is between 0 and 100', () => {
        const radar = { ...priceRule, metric: 'alpha_radar_new_position' as const, symbol: undefined, rearm: 'always' as const };
        assert.equal(alertRuleInputSchema.safeParse({ ...radar, threshold: 100 }).success, true);
        assert.equal(firstIssue(alertRuleInputSchema.safeParse({ ...radar, threshold: 101 })).message, 'Alpha Radar materiality score must be between 0 and 100');
    });

    test('refuses an unknown metric, comparator or rearm and a threshold that isn\'t a number', () => {
        assert.equal(alertRuleInputSchema.safeParse({ ...priceRule, metric: 'volume' }).success, false);
        assert.equal(alertRuleInputSchema.safeParse({ ...priceRule, comparator: 'ne' }).success, false);
        assert.equal(alertRuleInputSchema.safeParse({ ...priceRule, rearm: 'hourly' }).success, false);
        assert.equal(alertRuleInputSchema.safeParse({ ...priceRule, threshold: Number.POSITIVE_INFINITY }).success, false);
        assert.equal(alertRuleInputSchema.safeParse({ ...priceRule, threshold: '200' }).success, false);
    });
});

describe('alertRuleSchema (the Settings form)', () => {
    test('takes a blank symbol and note', () => {
        assert.equal(alertRuleSchema.safeParse({ ...priceRule, metric: 'portfolio_value', symbol: '', note: '' }).success, true);
        assert.equal(firstIssue(alertRuleSchema.safeParse({ ...priceRule, symbol: '' })).message, 'Symbol is required for this metric');
    });
});

describe('alertNotificationsReadSchema', () => {
    test('takes notification ids or all', () => {
        assert.equal(alertNotificationsReadSchema.safeParse({ ids: ['00000000-0000-4000-8000-000000000001'] }).success, true);
        assert.equal(alertNotificationsReadSchema.safeParse({ all: true }).success, true);
    });

    test('refuses anything else', () => {
        for (const body of [{}, { ids: [] }, { ids: ['n-1'] }, { all: false }, { all: true, ids: ['00000000-0000-4000-8000-000000000001'] },
            { ids: Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) }]) {
            assert.equal(alertNotificationsReadSchema.safeParse(body).success, false, JSON.stringify(body).slice(0, 80));
        }
    });
});
