import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { useAlertsStore } from './alertsStore';
import type { AlertTrigger } from '@/lib/alerts/types';

describe('alertsStore', () => {
    beforeEach(() => {
        useAlertsStore.setState({ rules: [], triggers: [] });
    });

    test('addRule assigns id + createdAt and appends', () => {
        const created = useAlertsStore.getState().addRule({
            name: 'test',
            metric: 'price',
            symbol: 'TSLA',
            comparator: 'gte',
            threshold: 300,
            enabled: true,
            rearm: 'always',
        });
        assert.ok(created.id);
        assert.ok(created.createdAt);
        assert.strictEqual(useAlertsStore.getState().rules.length, 1);
    });

    test('toggleRule flips enabled', () => {
        const rule = useAlertsStore.getState().addRule({
            name: 't', metric: 'price', symbol: 'TSLA',
            comparator: 'gte', threshold: 1, enabled: true, rearm: 'always',
        });
        useAlertsStore.getState().toggleRule(rule.id);
        assert.strictEqual(useAlertsStore.getState().rules[0].enabled, false);
    });

    test('deleteRule removes rule and its triggers', () => {
        const rule = useAlertsStore.getState().addRule({
            name: 't', metric: 'price', symbol: 'AAPL',
            comparator: 'gte', threshold: 1, enabled: true, rearm: 'always',
        });
        const trigger: AlertTrigger = {
            id: 'trig-1', ruleId: rule.id, ruleName: rule.name,
            metric: 'price', symbol: 'AAPL', comparator: 'gte', threshold: 1,
            observedValue: 5, triggeredAt: '2026-04-19T14:30:00Z', acknowledged: false,
        };
        useAlertsStore.getState().recordTriggers([trigger]);
        useAlertsStore.getState().deleteRule(rule.id);
        assert.strictEqual(useAlertsStore.getState().rules.length, 0);
        assert.strictEqual(useAlertsStore.getState().triggers.length, 0);
    });

    test('recordTriggers dedupes by id', () => {
        const rule = useAlertsStore.getState().addRule({
            name: 't', metric: 'price', symbol: 'AAPL',
            comparator: 'gte', threshold: 1, enabled: true, rearm: 'always',
        });
        const t: AlertTrigger = {
            id: 'dup', ruleId: rule.id, ruleName: rule.name,
            metric: 'price', symbol: 'AAPL', comparator: 'gte', threshold: 1,
            observedValue: 5, triggeredAt: '2026-04-19T14:30:00Z', acknowledged: false,
        };
        useAlertsStore.getState().recordTriggers([t]);
        useAlertsStore.getState().recordTriggers([t]);
        assert.strictEqual(useAlertsStore.getState().triggers.length, 1);
    });

    test('recordTriggers updates lastTriggeredAt on the matched rule', () => {
        const rule = useAlertsStore.getState().addRule({
            name: 't', metric: 'price', symbol: 'AAPL',
            comparator: 'gte', threshold: 1, enabled: true, rearm: 'always',
        });
        useAlertsStore.getState().recordTriggers([
            {
                id: 'x', ruleId: rule.id, ruleName: rule.name,
                metric: 'price', symbol: 'AAPL', comparator: 'gte', threshold: 1,
                observedValue: 5, triggeredAt: '2026-04-19T14:30:00Z', acknowledged: false,
            },
        ]);
        assert.strictEqual(
            useAlertsStore.getState().rules[0].lastTriggeredAt,
            '2026-04-19T14:30:00Z',
        );
    });

    test("rearm 'once' disables the rule after firing", () => {
        const rule = useAlertsStore.getState().addRule({
            name: 't', metric: 'price', symbol: 'AAPL',
            comparator: 'gte', threshold: 1, enabled: true, rearm: 'once',
        });
        useAlertsStore.getState().recordTriggers([
            {
                id: 'x', ruleId: rule.id, ruleName: rule.name,
                metric: 'price', symbol: 'AAPL', comparator: 'gte', threshold: 1,
                observedValue: 5, triggeredAt: '2026-04-19T14:30:00Z', acknowledged: false,
            },
        ]);
        assert.strictEqual(useAlertsStore.getState().rules[0].enabled, false);
    });

    test('acknowledgeTrigger / acknowledgeAll flip the flag', () => {
        const rule = useAlertsStore.getState().addRule({
            name: 't', metric: 'price', symbol: 'AAPL',
            comparator: 'gte', threshold: 1, enabled: true, rearm: 'always',
        });
        useAlertsStore.getState().recordTriggers([
            {
                id: 'a', ruleId: rule.id, ruleName: rule.name,
                metric: 'price', symbol: 'AAPL', comparator: 'gte', threshold: 1,
                observedValue: 5, triggeredAt: '2026-04-19T14:30:00Z', acknowledged: false,
            },
            {
                id: 'b', ruleId: rule.id, ruleName: rule.name,
                metric: 'price', symbol: 'AAPL', comparator: 'gte', threshold: 1,
                observedValue: 6, triggeredAt: '2026-04-19T14:35:00Z', acknowledged: false,
            },
        ]);
        useAlertsStore.getState().acknowledgeTrigger('a');
        assert.strictEqual(
            useAlertsStore.getState().triggers.find((t) => t.id === 'a')?.acknowledged,
            true,
        );
        useAlertsStore.getState().acknowledgeAll();
        assert.strictEqual(
            useAlertsStore.getState().triggers.every((t) => t.acknowledged),
            true,
        );
    });
});
