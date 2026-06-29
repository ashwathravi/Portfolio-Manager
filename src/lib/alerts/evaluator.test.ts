import { test, describe } from 'node:test';
import assert from 'node:assert';
import { compare, observeMetric, canFire, evaluateAlerts, describeRule } from './evaluator';
import type { AlertRule, MarketSnapshot } from './types';

const baseRule: AlertRule = {
    id: 'r1',
    name: 'AAPL price alert',
    metric: 'price',
    symbol: 'AAPL',
    comparator: 'gte',
    threshold: 150,
    enabled: true,
    rearm: 'always',
    createdAt: '2026-04-19T09:00:00Z',
};

const baseSnapshot: MarketSnapshot = {
    quotes: {
        AAPL: { price: 175.5, changePercent: 0.0123 },
        TSLA: { price: 240, changePercent: -0.021 },
    },
    portfolioValue: 125000,
    portfolioDayChangePct: 0.008,
    observedAt: '2026-04-19T14:30:00Z',
};

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

describe('observeMetric', () => {
    test('price rule reads the symbol quote price', () => {
        assert.strictEqual(observeMetric(baseRule, baseSnapshot), 175.5);
    });

    test('returns null when symbol missing from snapshot', () => {
        const rule = { ...baseRule, symbol: 'MSFT' };
        assert.strictEqual(observeMetric(rule, baseSnapshot), null);
    });

    test('returns null when price rule has no symbol', () => {
        const rule: AlertRule = { ...baseRule, symbol: undefined };
        assert.strictEqual(observeMetric(rule, baseSnapshot), null);
    });

    test('price_change_pct reads the changePercent', () => {
        const rule: AlertRule = { ...baseRule, metric: 'price_change_pct' };
        assert.strictEqual(observeMetric(rule, baseSnapshot), 0.0123);
    });

    test('portfolio_value reads the portfolio total', () => {
        const rule: AlertRule = { ...baseRule, metric: 'portfolio_value', symbol: undefined };
        assert.strictEqual(observeMetric(rule, baseSnapshot), 125000);
    });

    test('portfolio_day_change_pct reads the portfolio change', () => {
        const rule: AlertRule = { ...baseRule, metric: 'portfolio_day_change_pct', symbol: undefined };
        assert.strictEqual(observeMetric(rule, baseSnapshot), 0.008);
    });

    test('symbol lookup is case-insensitive', () => {
        const rule: AlertRule = { ...baseRule, symbol: 'aapl' };
        assert.strictEqual(observeMetric(rule, baseSnapshot), 175.5);
    });

    test('Alpha Radar metrics are ignored by market snapshot evaluation', () => {
        const rule: AlertRule = {
            ...baseRule,
            metric: 'alpha_radar_user_overlap',
            symbol: undefined,
            threshold: 80,
        };
        assert.strictEqual(observeMetric(rule, baseSnapshot), null);
    });
});

describe('canFire', () => {
    test('disabled rules cannot fire', () => {
        const rule: AlertRule = { ...baseRule, enabled: false };
        assert.strictEqual(canFire(rule, baseSnapshot), false);
    });

    test('rule that never triggered can fire', () => {
        assert.strictEqual(canFire(baseRule, baseSnapshot), true);
    });

    test('rearm once blocks after a trigger', () => {
        const rule: AlertRule = {
            ...baseRule,
            rearm: 'once',
            lastTriggeredAt: '2026-04-18T14:30:00Z',
        };
        assert.strictEqual(canFire(rule, baseSnapshot), false);
    });

    test('rearm always allows repeated triggers', () => {
        const rule: AlertRule = {
            ...baseRule,
            rearm: 'always',
            lastTriggeredAt: '2026-04-19T14:29:00Z',
        };
        assert.strictEqual(canFire(rule, baseSnapshot), true);
    });

    test('rearm daily blocks a second trigger on the same UTC day', () => {
        const rule: AlertRule = {
            ...baseRule,
            rearm: 'daily',
            lastTriggeredAt: '2026-04-19T09:00:00Z',
        };
        assert.strictEqual(canFire(rule, baseSnapshot), false);
    });

    test('rearm daily allows a trigger on a new UTC day', () => {
        const rule: AlertRule = {
            ...baseRule,
            rearm: 'daily',
            lastTriggeredAt: '2026-04-18T23:00:00Z',
        };
        assert.strictEqual(canFire(rule, baseSnapshot), true);
    });
});

describe('evaluateAlerts', () => {
    test('fires a price rule when threshold is crossed', () => {
        const triggers = evaluateAlerts([baseRule], baseSnapshot);
        assert.strictEqual(triggers.length, 1);
        assert.strictEqual(triggers[0].ruleId, 'r1');
        assert.strictEqual(triggers[0].observedValue, 175.5);
        assert.strictEqual(triggers[0].acknowledged, false);
    });

    test('does not fire when threshold is not met', () => {
        const rule: AlertRule = { ...baseRule, threshold: 200 };
        const triggers = evaluateAlerts([rule], baseSnapshot);
        assert.strictEqual(triggers.length, 0);
    });

    test('fires portfolio-level rules', () => {
        const rule: AlertRule = {
            id: 'r2',
            name: 'Portfolio gain alert',
            metric: 'portfolio_day_change_pct',
            comparator: 'gte',
            threshold: 0.005,
            enabled: true,
            rearm: 'daily',
            createdAt: '2026-04-19T09:00:00Z',
        };
        const triggers = evaluateAlerts([rule], baseSnapshot);
        assert.strictEqual(triggers.length, 1);
        assert.strictEqual(triggers[0].observedValue, 0.008);
    });

    test('fires negative-direction rule (lte on drop)', () => {
        const rule: AlertRule = {
            ...baseRule,
            id: 'r3',
            symbol: 'TSLA',
            metric: 'price_change_pct',
            comparator: 'lte',
            threshold: -0.01,
        };
        const triggers = evaluateAlerts([rule], baseSnapshot);
        assert.strictEqual(triggers.length, 1);
    });

    test('skips rules whose symbol is not in the snapshot', () => {
        const rule: AlertRule = { ...baseRule, symbol: 'MSFT' };
        const triggers = evaluateAlerts([rule], baseSnapshot);
        assert.strictEqual(triggers.length, 0);
    });

    test('only enabled rules are evaluated', () => {
        const enabled: AlertRule = { ...baseRule };
        const disabled: AlertRule = { ...baseRule, id: 'r-disabled', enabled: false };
        const triggers = evaluateAlerts([enabled, disabled], baseSnapshot);
        assert.strictEqual(triggers.length, 1);
        assert.strictEqual(triggers[0].ruleId, 'r1');
    });

    test('trigger ids are unique per rule + snapshot timestamp', () => {
        const triggers = evaluateAlerts([baseRule], baseSnapshot);
        assert.strictEqual(triggers[0].id, `r1-${baseSnapshot.observedAt}`);
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
