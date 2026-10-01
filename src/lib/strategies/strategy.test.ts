import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SEED_STRATEGIES } from './seed';
import {
    addRule,
    duplicateStrategy,
    hasUnbacktestedChanges,
    removeRule,
    setConjunction,
    setGuardrail,
    summarizeRules,
    toggleUniverseFilter,
} from './strategy';

const base = SEED_STRATEGIES[0];

describe('strategy reducers', () => {
    test('addRule appends a rule and glues it with AND by default', () => {
        const next = addRule(base.rules, base.conjunctions, { id: 'x', field: 'P/E', op: '<', value: '20' });
        assert.strictEqual(next.rules.length, base.rules.length + 1);
        assert.strictEqual(next.conjunctions.at(-1), 'AND');
    });

    test('addRule to an empty rule set adds no conjunction', () => {
        const next = addRule([], [], { id: 'x', field: 'P/E', op: '<', value: '20' }, 'OR');
        assert.deepStrictEqual(next.conjunctions, []);
    });

    test('removeRule drops the rule and its left-side conjunction; unknown ids are a no-op', () => {
        const next = removeRule(base.rules, base.conjunctions, base.rules[1].id);
        assert.strictEqual(next.rules.length, base.rules.length - 1);
        assert.strictEqual(next.conjunctions.length, base.conjunctions.length - 1);
        assert.deepStrictEqual(removeRule(base.rules, base.conjunctions, 'missing').rules, base.rules);
    });

    test('setConjunction, toggleUniverseFilter, setGuardrail return new values', () => {
        assert.strictEqual(setConjunction(['AND', 'AND'], 1, 'OR')[1], 'OR');
        const toggled = toggleUniverseFilter(base.universe, base.universe[0].id);
        assert.strictEqual(toggled[0].enabled, !base.universe[0].enabled);
        const g = setGuardrail(base.guardrails, 'maxPositionPct', 7);
        assert.strictEqual(g.maxPositionPct, 7);
        assert.notStrictEqual(g, base.guardrails);
    });

    test('summarizeRules', () => {
        assert.strictEqual(summarizeRules({ rules: [] }), 'No rules');
        assert.strictEqual(summarizeRules({ rules: [base.rules[0]] }), '1 rule');
        assert.strictEqual(summarizeRules(base), `${base.rules.length} rules`);
    });
});

describe('duplicateStrategy', () => {
    test('creates a paused copy with a fresh id, short id, and name', () => {
        const copy = duplicateStrategy(base, SEED_STRATEGIES);
        assert.strictEqual(copy.id, `${base.id}-copy-1`);
        assert.strictEqual(copy.shortId, 'S-004');
        assert.strictEqual(copy.name, `${base.name} (copy)`);
        assert.strictEqual(copy.status, 'paused');
        assert.notStrictEqual(copy.rules, base.rules);
        assert.ok(copy.rules.every((r, i) => r.id !== base.rules[i].id));
    });

    test('a second copy gets the next id and a numbered name', () => {
        const first = duplicateStrategy(base, SEED_STRATEGIES);
        const second = duplicateStrategy(base, [...SEED_STRATEGIES, first]);
        assert.strictEqual(second.id, `${base.id}-copy-2`);
        assert.strictEqual(second.shortId, 'S-005');
        assert.strictEqual(second.name, `${base.name} (copy 2)`);
    });

    test('copying a strategy that has not been backtested keeps that status', () => {
        const pending = SEED_STRATEGIES.find((s) => s.status === 'backtesting');
        assert.ok(pending);
        assert.strictEqual(duplicateStrategy(pending, SEED_STRATEGIES).status, 'backtesting');
    });
});

describe('hasUnbacktestedChanges', () => {
    test('an unedited strategy and a fresh copy match their backtest', () => {
        assert.strictEqual(hasUnbacktestedChanges(base, base), false);
        assert.strictEqual(hasUnbacktestedChanges(duplicateStrategy(base, SEED_STRATEGIES), base), false);
    });

    test('changing a rule value, universe filter, or guardrail flags the backtest as stale', () => {
        assert.strictEqual(hasUnbacktestedChanges({ ...base, rules: base.rules.map((r, i) => (i === 0 ? { ...r, value: '0.9' } : r)) }, base), true);
        assert.strictEqual(hasUnbacktestedChanges({ ...base, universe: toggleUniverseFilter(base.universe, base.universe[0].id) }, base), true);
        assert.strictEqual(hasUnbacktestedChanges({ ...base, guardrails: setGuardrail(base.guardrails, 'maxPositionPct', 9) }, base), true);
    });
});
